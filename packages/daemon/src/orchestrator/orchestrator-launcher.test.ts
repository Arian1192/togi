import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, mock, test } from "node:test";
import {
  type Actor,
  DEFAULT_FLOW,
  genericPlannerV2,
  type SessionEnded,
  type SessionStarted,
  specialistHash,
  specialistStream,
  toDomainEvent,
} from "@togi/core";
import type Database from "better-sqlite3";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { RedactingBlobStore } from "../blobs/redacting-blob-store.ts";
import { type CreateTaskInput, createHandler } from "../commands/handle-command.ts";
import { paths } from "../config/app.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { publishBuiltinSpecialists } from "../specialists/publish-builtin.ts";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { FakePlanner } from "../testing/fake-planner.ts";
import { LauncherPlanner } from "../testing/launcher-planner.ts";
import { AgentEventStore } from "../trajectory/agent-event-store.ts";
import { createWorkerLauncher } from "../worker/worker-launcher.ts";
import { createOrchestrator } from "./orchestrator.ts";

let home: string;
let db: Database.Database;
let store: SqliteEventStore;
let handle: ReturnType<typeof createHandler>;
let launcher: ReturnType<typeof createWorkerLauncher>;
const human: Actor = { kind: "human", userId: "usr_1" };
const newTask: CreateTaskInput = {
  type: "create",
  title: "Filtro",
  description: "d",
  acceptanceCriteria: "criterio",
  risk: "low",
  repo: "r",
  baseBranch: "main",
  source: { kind: "cli" },
};
const stateOf = (n: number) =>
  (db.prepare("SELECT state FROM tasks WHERE number = ?").get(n) as { state: string }).state;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-orq-launch-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  store = new SqliteEventStore(db);
  const keys = new DataKeyring(
    db,
    await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } })),
  );
  const blobs = new RedactingBlobStore(new FileBlobStore(p.blobs, keys));
  handle = createHandler({ db, store, blobs });
  launcher = createWorkerLauncher({
    agentEvents: new AgentEventStore(db, blobs),
    workerEntry: join(import.meta.dirname, "..", "worker", "testing", "fake-agent-worker.ts"),
    graceMs: 300,
  });
  db.prepare("INSERT INTO repos (repo, path, added_at) VALUES ('r', '/clon/r', 'now')").run();
});
afterEach(() => {
  mock.restoreAll();
  db.close();
  rmSync(home, { recursive: true, force: true });
});

const submitted = async () => {
  const r = await handle(human, newTask);
  assert.ok("number" in r);
  await handle(human, { type: "submit", number: r.number });
  return r.number;
};

/** Los eventos de un stream, con su seq global, ya tipados. */
async function eventsOf(stream: string) {
  const out = [];
  for await (const stored of store.readStream(stream)) out.push(stored);
  return out;
}
const taskEvents = async (n: number, type: string) =>
  (await eventsOf(`task:${n}`)).filter((e) => e.type === type);

test("ciclo completo con el lanzador real: plan propuesto y recuentos y uso reales", async () => {
  const planner = new LauncherPlanner(launcher);
  const orq = createOrchestrator({ db, store, handle, planner, flow: DEFAULT_FLOW });
  orq.start();
  const n = await submitted();
  await orq.idle();
  assert.equal(stateOf(n), "plan_review");

  const [ended] = await taskEvents(n, "session.ended");
  const payload = toDomainEvent(ended as never).payload as SessionEnded;
  assert.equal(payload.outcome, "completed");
  assert.equal(payload.failureReason, null);
  assert.equal(payload.trajectoryEvents, 4); // 2 mensajes + 2 usage
  assert.deepEqual(
    [payload.usage.inputTokens, payload.usage.outputTokens, payload.usage.estimatedCostUsd],
    [200, 100, 0.75],
  );
  await orq.close();
});

test("session.started registra el especialista con su versión y su hash, y prompt y política", async () => {
  const orq = createOrchestrator({
    db,
    store,
    handle,
    planner: new LauncherPlanner(launcher),
    flow: DEFAULT_FLOW,
  });
  orq.start();
  const n = await submitted();
  await orq.idle();
  const [started] = await taskEvents(n, "session.started");
  const s = toDomainEvent(started as never).payload as SessionStarted;
  assert.deepEqual(s.specialist, {
    id: "generic-planner",
    version: 2,
    hash: "sha256:f1ed338218434e7d82148037f5b02b5eee4b0ea5a531572cf751b3789f744eff",
  });
  assert.equal(s.specialist?.hash, specialistHash(genericPlannerV2));
  assert.equal(s.model, genericPlannerV2.model);
  assert.equal(s.runtime.id, "fake-agent");
  assert.equal(s.prompt.dataClass, "prompt");
  assert.equal(s.policy.dataClass, "prompt");
  await orq.close();
});

test("el especialista se publica justo antes de la primera sesión y no se repite", async () => {
  const orq = createOrchestrator({
    db,
    store,
    handle,
    planner: new LauncherPlanner(launcher),
    flow: DEFAULT_FLOW,
  });
  await orq.recover();
  orq.start();
  // Sin ninguna tarea, arrancar no escribe nada en el log del especialista.
  assert.deepEqual(await eventsOf(specialistStream("generic-planner")), []);

  const first = await submitted();
  await orq.idle();
  const published = await eventsOf(specialistStream("generic-planner"));
  assert.deepEqual(
    published.map((e) => e.type),
    ["specialist.version_published"],
  );
  const [started] = await taskEvents(first, "session.started");
  assert.ok((published[0]?.seq ?? Infinity) < (started?.seq ?? 0));

  await submitted();
  await orq.idle();
  assert.equal((await eventsOf(specialistStream("generic-planner"))).length, 1);
  await orq.close();
});

test("un hash que no coincide con el publicado impide la sesión y pide subir la versión", async () => {
  const log = mock.method(console, "error", () => {});
  await publishBuiltinSpecialists(store, [{ ...genericPlannerV2, instructions: "otras" }]);
  const planner = new LauncherPlanner(launcher);
  const orq = createOrchestrator({ db, store, handle, planner, flow: DEFAULT_FLOW });
  orq.start();
  const n = await submitted();
  await orq.idle();
  assert.equal(stateOf(n), "planning");
  assert.deepEqual(await taskEvents(n, "session.started"), []);
  assert.equal(planner.calls.length, 0);
  assert.match(String(log.mock.calls.at(-1)?.arguments[0]), /generic-planner@2/);
  await orq.close();
});

test("el motivo de cada fallo llega a session.ended, también con el uso real", async () => {
  const reasons: [string, string][] = [
    ["fail:max_turns_exceeded", "max_turns_exceeded"],
    ["fail:budget_exceeded", "budget_exceeded"],
    ["fail:inventado", "agent_failed"],
    ["die", "worker_died"],
  ];
  mock.method(console, "error", () => {});
  for (const [mode, expected] of reasons) {
    const orq = createOrchestrator({
      db,
      store,
      handle,
      planner: new LauncherPlanner(launcher, mode),
      flow: DEFAULT_FLOW,
    });
    orq.start();
    const n = await submitted();
    await orq.idle();
    const [ended] = await taskEvents(n, "session.ended");
    const e = toDomainEvent(ended as never).payload as SessionEnded;
    assert.deepEqual([e.outcome, e.failureReason], ["failed", expected], mode);
    assert.equal(stateOf(n), "planning");
    if (mode !== "die") assert.equal(e.usage.estimatedCostUsd, 0.75, mode);
    await orq.close();
  }
});

test("una respuesta que no es un plan cierra la sesión como planner_failed", async () => {
  mock.method(console, "error", () => {});
  const orq = createOrchestrator({
    db,
    store,
    handle,
    planner: new LauncherPlanner(launcher, "plan", "no es JSON"),
    flow: DEFAULT_FLOW,
  });
  orq.start();
  const n = await submitted();
  await orq.idle();
  const [ended] = await taskEvents(n, "session.ended");
  const e = toDomainEvent(ended as never).payload as SessionEnded;
  assert.deepEqual([e.outcome, e.failureReason], ["failed", "planner_failed"]);
  assert.equal(e.trajectoryEvents, 4);
  await orq.close();
});

test("al arrancar no se relanza una tarea cuya última sesión falló", async () => {
  mock.method(console, "error", () => {});
  const failing = createOrchestrator({
    db,
    store,
    handle,
    planner: new FakePlanner(() => true),
  });
  failing.start();
  const failed = await submitted();
  await failing.idle();
  await failing.close();
  assert.equal(stateOf(failed), "planning");

  const planner = new FakePlanner();
  const orq = createOrchestrator({ db, store, handle, planner });
  await orq.recover();
  await orq.idle();
  assert.equal(planner.calls.length, 0);
  assert.equal(stateOf(failed), "planning");
  await orq.close();
});

test("al arrancar sí se re-encola una tarea que volvió a planning tras una petición de cambios", async () => {
  const first = createOrchestrator({ db, store, handle, planner: new FakePlanner() });
  first.start();
  const n = await submitted();
  await first.idle();
  await first.close();
  assert.equal(stateOf(n), "plan_review");
  await handle(human, {
    type: "requestPlanChanges",
    number: n,
    planVersion: 1,
    category: "scope",
    text: "más pequeño",
  });
  assert.equal(stateOf(n), "planning");

  const planner = new FakePlanner();
  const orq = createOrchestrator({ db, store, handle, planner });
  await orq.recover();
  await orq.idle();
  assert.equal(planner.calls.length, 1);
  assert.equal(stateOf(n), "plan_review");
  await orq.close();
});
