import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { Actor } from "@togi/core";
import type Database from "better-sqlite3";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { type CreateTaskInput, createHandler } from "../commands/handle-command.ts";
import { paths } from "../config/app.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { FakePlanner } from "../testing/fake-planner.ts";
import { createOrchestrator } from "./orchestrator.ts";

let home: string;
let db: Database.Database;
let store: SqliteEventStore;
let handle: ReturnType<typeof createHandler>;
const human: Actor = { kind: "human", userId: "usr_1" };
const system: Actor = { kind: "system", component: "adapter:planner" };
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
const sessions = (n: number) =>
  db
    .prepare("SELECT state, outcome FROM sessions WHERE task_number = ? ORDER BY started_at, rowid")
    .all(n) as { state: string; outcome: string | null }[];
const create = async () => {
  const r = await handle(human, newTask);
  assert.ok("number" in r);
  return r.number;
};
const submit = (number: number) => handle(human, { type: "submit", number });
const setup = (planner?: FakePlanner) => createOrchestrator({ db, store, handle, planner });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-orq-"));
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
  db.close();
  rmSync(home, { recursive: true, force: true });
});

test("submit lleva solo a plan_review, con el plan del agente y la sesión cerrada", async () => {
  const orq = setup(new FakePlanner());
  orq.start();
  const n = await create();
  await submit(n);
  await orq.idle();
  assert.equal(stateOf(n), "plan_review");
  assert.deepEqual(sessions(n), [{ state: "ended", outcome: "completed" }]);
  const session = db.prepare("SELECT runtime, specialist FROM sessions").get();
  assert.deepEqual(session, { runtime: "fake@1", specialist: "fake-planner@1" });
  const proposed = db.prepare("SELECT actor FROM events WHERE type = 'plan.proposed'").get() as {
    actor: string;
  };
  assert.equal(JSON.parse(proposed.actor).kind, "agent");
  await orq.close();
});

test("request-changes produce la versión 2 del plan", async () => {
  const orq = setup(new FakePlanner());
  orq.start();
  const n = await create();
  await submit(n);
  await orq.idle();
  await handle(human, {
    type: "requestPlanChanges",
    number: n,
    planVersion: 1,
    category: "scope",
    text: "menos",
  });
  await orq.idle();
  assert.equal(stateOf(n), "plan_review");
  const versions = db.prepare("SELECT plan_version FROM plans ORDER BY plan_version").all();
  assert.deepEqual(versions, [{ plan_version: 1 }, { plan_version: 2 }]);
  assert.equal(sessions(n).length, 2);
  await orq.close();
});

test("dos tareas enviadas a la vez se planifican una detrás de otra", async () => {
  const planner = new FakePlanner();
  const orq = setup(planner);
  orq.start();
  const [a, b] = [await create(), await create()];
  await Promise.all([submit(a), submit(b)]);
  await orq.idle();
  assert.equal(planner.maxConcurrent, 1);
  assert.equal(planner.calls.length, 2);
  assert.equal(stateOf(a), "plan_review");
  assert.equal(stateOf(b), "plan_review");
  await orq.close();
});

test("un fallo del planificador deja la tarea en planning con su sesión cerrada", async () => {
  const orq = setup(new FakePlanner(() => true));
  orq.start();
  const n = await create();
  await submit(n);
  await orq.idle();
  assert.equal(stateOf(n), "planning");
  assert.deepEqual(sessions(n), [{ state: "ended", outcome: "failed" }]);
  await orq.close();
});

test("una tarea ya en cola o en curso no se encola otra vez", async () => {
  const planner = new FakePlanner();
  const orq = setup(planner);
  orq.start();
  const n = await create();
  await submit(n);
  await orq.recover(); // vuelve a ver la tarea en planning mientras se planifica
  await orq.idle();
  assert.equal(planner.calls.length, 1);
  assert.equal(sessions(n).length, 1);
  await orq.close();
});

test("sin Planner no se crea ninguna sesión y la tarea sigue en planning", async () => {
  const orq = setup();
  orq.start();
  const n = await create();
  await submit(n);
  await orq.recover();
  await orq.idle();
  assert.equal(stateOf(n), "planning");
  assert.deepEqual(sessions(n), []);
  await orq.close();
});

test("al arrancar, una sesión abierta se cierra como failed y la tarea sin sesión se re-encola", async () => {
  const n = await create();
  await submit(n);
  const m = await create();
  await submit(m);
  // La tarea n se quedó con una sesión abierta; la m, sin sesión.
  await handle(system, {
    type: "startSession",
    number: n,
    session: {
      sessionId: "ses_viejo",
      role: "planner",
      cycle: null,
      runtime: { id: "fake", version: "1" },
      model: "fake",
      specialist: { id: "fake-planner", version: 1, hash: "sha256:x" },
      workspaceId: null,
      prompt: "p",
      policy: "p",
    },
  });
  const planner = new FakePlanner();
  const orq = setup(planner);
  await orq.recover();
  orq.start();
  await orq.idle();
  assert.deepEqual(sessions(n)[0], { state: "ended", outcome: "failed" });
  assert.equal(stateOf(n), "plan_review");
  assert.equal(stateOf(m), "plan_review");
  assert.equal(planner.calls.length, 2);
  await orq.close();
});

test("un repo sin registrar cierra la sesión como failed sin llamar al planificador", async () => {
  const planner = new FakePlanner();
  const orq = setup(planner);
  orq.start();
  db.prepare("DELETE FROM repos").run();
  const n = await create();
  await submit(n);
  await orq.idle();
  assert.equal(stateOf(n), "planning");
  assert.deepEqual(sessions(n), [{ state: "ended", outcome: "failed" }]);
  assert.equal(planner.calls.length, 0);
  await orq.close();
});

test("el repo registrado con otras mayúsculas también vale", async () => {
  const orq = setup(new FakePlanner());
  orq.start();
  db.prepare("DELETE FROM repos").run();
  db.prepare("INSERT INTO repos (repo, path, added_at) VALUES ('R', '/clon/r', 'now')").run();
  const n = await create();
  await submit(n);
  await orq.idle();
  assert.equal(stateOf(n), "plan_review");
  await orq.close();
});
