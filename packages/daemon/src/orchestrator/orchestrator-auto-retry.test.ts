import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, mock, test } from "node:test";
import { type Actor, FAILURE_REASONS, isTransientFailure } from "@togi/core";
import type Database from "better-sqlite3";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { createHandler } from "../commands/handle-command.ts";
import { paths } from "../config/app.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import type { Notification } from "../notify/notifier.ts";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { FakePlanner } from "../testing/fake-planner.ts";
import { createOrchestrator } from "./orchestrator.ts";
import type { Planner } from "./planner.ts";

const human: Actor = { kind: "human", userId: "usr_1" };
const usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, durationMs: 0 };

let home: string;
let db: Database.Database;
let store: SqliteEventStore;
let handle: ReturnType<typeof createHandler>;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-orq-auto-retry-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  store = new SqliteEventStore(db);
  const keys = new DataKeyring(
    db,
    await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } })),
  );
  handle = createHandler({ db, store, blobs: new FileBlobStore(p.blobs, keys) });
  db.prepare("INSERT INTO repos (repo, path, added_at) VALUES ('r', '/clon/r', 'now')").run();
});
afterEach(() => {
  mock.restoreAll();
  db.close();
  rmSync(home, { recursive: true, force: true });
});

/** Un planificador que, en cada llamada, falla con el código siguiente de la lista (`null` = plan). */
function scripted(codes: (string | null)[]): Planner & { calls: number } {
  const ok = new FakePlanner();
  const planner = {
    identity: ok.identity,
    calls: 0,
    async plan(request: Parameters<Planner["plan"]>[0]) {
      const code = codes[planner.calls++] ?? null;
      if (code === null) return ok.plan(request);
      return { ok: false as const, code, reason: `fallo simulado ${code}`, usage };
    },
  };
  return planner as Planner & { calls: number };
}

async function submitted(): Promise<number> {
  const made = await handle(human, {
    type: "create",
    title: "Filtro",
    description: "d",
    acceptanceCriteria: "criterio",
    risk: "low",
    repo: "r",
    baseBranch: "main",
    source: { kind: "cli" },
  });
  assert.ok("number" in made);
  await handle(human, { type: "submit", number: made.number });
  return made.number;
}
const failures = (n: number) =>
  (
    db
      .prepare("SELECT failure_reason AS r FROM sessions WHERE task_number = ? ORDER BY rowid")
      .all(n) as { r: string | null }[]
  ).map((s) => s.r);
const stateOf = (n: number) =>
  (db.prepare("SELECT state FROM tasks WHERE number = ?").get(n) as { state: string }).state;
const retries = (n: number) =>
  db
    .prepare("SELECT actor FROM events WHERE stream = ? AND type = 'plan.retry_requested'")
    .all(`task:${n}`)
    .map((e) => (JSON.parse((e as { actor: string }).actor) as Actor).kind);

/** Planifica una tarea con este planificador y devuelve lo que se notificó y se escribió en el log. */
async function run(planner: Planner) {
  const sent: Notification[] = [];
  const log = mock.method(console, "error", () => {});
  const orchestrator = createOrchestrator({
    db,
    store,
    handle,
    planner,
    notify: (x) => sent.push(x),
  });
  orchestrator.start();
  const n = await submitted();
  await orchestrator.idle();
  return {
    n,
    sent,
    orchestrator,
    lines: () => log.mock.calls.map((c) => String(c.arguments[0])),
  };
}

for (const code of ["worker_died", "trajectory_write_failed"]) {
  test(`un fallo ${code} se reintenta una vez, con actor system y sin avisar del primero`, async () => {
    const { n, sent, orchestrator, lines } = await run(scripted([code, null]));
    assert.deepEqual(failures(n), [code, null]);
    assert.deepEqual(retries(n), ["system"]);
    assert.equal(stateOf(n), "plan_review");
    assert.deepEqual(
      sent.map((x) => x.title),
      ["togi: plan listo"],
    );
    const retryLine = lines().find((l) => l.includes("se reintenta automáticamente"));
    assert.ok(retryLine?.includes(`tarea ${n}`) && retryLine.includes(code), lines().join("\n"));
    assert.ok(!lines().some((l) => l.includes("siguiente paso")), lines().join("\n"));
    await orchestrator.close();
  });
}

test("el reintento queda en el log antes de la sesión nueva", async () => {
  const { n, orchestrator } = await run(scripted(["worker_died", null]));
  const types: string[] = [];
  for await (const e of store.readStream(`task:${n}`)) types.push(e.type);
  const at = types.indexOf("plan.retry_requested");
  assert.equal(types[at - 1], "session.ended");
  assert.equal(types[at + 1], "session.started");
  await orchestrator.close();
});

test("dos fallos pasajeros seguidos: un solo reintento, el segundo fallo avisa y no hay más sesiones", async () => {
  const planner = scripted(["worker_died", "worker_died", null]);
  const { n, sent, orchestrator, lines } = await run(planner);
  assert.deepEqual(failures(n), ["worker_died", "worker_died"]);
  assert.deepEqual(retries(n), ["system"]);
  assert.equal(planner.calls, 2);
  assert.equal(stateOf(n), "planning");
  assert.deepEqual(sent, [
    {
      title: "togi: sesión fallida",
      message: `#${n} · worker_died · togi plan retry ${n}`,
    },
  ]);
  const last = lines().at(-1) ?? "";
  assert.match(last, new RegExp(`la tarea ${n} no se reintenta automáticamente \\(worker_died\\)`));
  assert.match(last, new RegExp(`siguiente paso: reintenta con togi plan retry ${n}$`));
  await orchestrator.close();
});

test("el resto de motivos no se reintenta y avisa como hoy", async () => {
  const others = FAILURE_REASONS.filter((c) => !isTransientFailure(c) && c !== "daemon_restarted");
  assert.ok(others.length >= 8);
  for (const code of others) {
    const planner = scripted([code, null]);
    const { n, sent, orchestrator } = await run(planner);
    assert.deepEqual(failures(n), [code], code);
    assert.deepEqual(retries(n), [], code);
    assert.equal(planner.calls, 1, code);
    assert.equal(sent.length, 1, code);
    assert.equal(stateOf(n), "planning", code);
    await orchestrator.close();
    mock.restoreAll();
  }
});

test("tras agotar el reintento automático, un plan retry humano vuelve a funcionar y reinicia la cuenta", async () => {
  const planner = scripted(["worker_died", "worker_died", "worker_died", null]);
  const { n, orchestrator } = await run(planner);
  assert.equal(stateOf(n), "planning");
  const asked = await handle(human, { type: "requestPlanRetry", number: n });
  assert.ok("events" in asked, JSON.stringify(asked));
  await orchestrator.idle();
  // La sesión 3 falla otra vez, y como el reintento humano reinició la cuenta, vuelve a reintentarse.
  assert.deepEqual(failures(n), ["worker_died", "worker_died", "worker_died", null]);
  assert.deepEqual(retries(n), ["system", "human", "system"]);
  assert.equal(stateOf(n), "plan_review");
  await orchestrator.close();
});

test("un reinicio del daemon no cuenta como reintento", async () => {
  const n = await submitted();
  const ok = new FakePlanner();
  const started = await handle(
    { kind: "system", component: "adapter:planner" },
    {
      type: "startSession",
      number: n,
      session: {
        ...ok.identity,
        sessionId: "ses_abierta",
        role: "planner",
        cycle: null,
        workspaceId: null,
      },
    },
  );
  assert.ok("events" in started);
  mock.method(console, "error", () => {});
  const orchestrator = createOrchestrator({
    db,
    store,
    handle,
    planner: scripted(["worker_died", null]),
  });
  await orchestrator.recover();
  orchestrator.start();
  await orchestrator.idle();
  // Cortada por el reinicio, luego fallo pasajero (aún tiene su reintento) y, por fin, el plan.
  assert.deepEqual(failures(n), ["daemon_restarted", "worker_died", null]);
  assert.deepEqual(retries(n), ["system"]);
  await orchestrator.close();
});

test("recover vuelve a encolar una tarea con una petición de reintento sin sesión después", async () => {
  const n = await submitted(); // sin orquestador: nadie abre sesión
  const asked = await handle(human, { type: "requestPlanRetry", number: n });
  assert.ok("events" in asked);
  assert.deepEqual(failures(n), []);
  const planner = scripted([null]);
  const orchestrator = createOrchestrator({ db, store, handle, planner });
  await orchestrator.recover();
  await orchestrator.idle();
  assert.equal(planner.calls, 1);
  assert.deepEqual(failures(n), [null]);
  assert.equal(stateOf(n), "plan_review");
  await orchestrator.close();
});

test("recover atiende un reintento automático que el reinicio cortó antes de abrir la sesión", async () => {
  const n = await submitted(); // sin orquestador: lo que sigue lo escribe el «daemon anterior»
  const worker = { kind: "system", component: "adapter:planner" } as const;
  const started = await handle(worker, {
    type: "startSession",
    number: n,
    session: {
      ...new FakePlanner().identity,
      sessionId: "ses_1",
      role: "planner",
      cycle: null,
      workspaceId: null,
    },
  });
  assert.ok("events" in started);
  const ended = await handle(worker, {
    type: "endSession",
    number: n,
    session: {
      sessionId: "ses_1",
      outcome: "failed",
      usage,
      trajectoryEvents: 0,
      failureReason: "worker_died",
    },
  });
  assert.ok("events" in ended);
  const asked = await handle(worker, { type: "requestPlanRetry", number: n });
  assert.ok("events" in asked, JSON.stringify(asked));
  // El daemon cae aquí: la petición está en el log y no hay sesión después.
  const planner = scripted([null]);
  const orchestrator = createOrchestrator({ db, store, handle, planner });
  await orchestrator.recover();
  await orchestrator.idle();
  assert.equal(planner.calls, 1);
  assert.deepEqual(failures(n), ["worker_died", null]);
  assert.deepEqual(retries(n), ["system"]);
  assert.equal(stateOf(n), "plan_review");
  await orchestrator.close();
});

test("recover no encola una tarea cuya petición de reintento ya tuvo sesión", async () => {
  const first = await run(scripted(["timeout", "timeout"]));
  await handle(human, { type: "requestPlanRetry", number: first.n });
  await first.orchestrator.idle();
  await first.orchestrator.close();
  mock.restoreAll();
  assert.deepEqual(failures(first.n), ["timeout", "timeout"]);
  const planner = scripted([null]);
  const orchestrator = createOrchestrator({ db, store, handle, planner });
  await orchestrator.recover();
  await orchestrator.idle();
  assert.equal(planner.calls, 0);
  assert.deepEqual(failures(first.n), ["timeout", "timeout"]);
  await orchestrator.close();
});
