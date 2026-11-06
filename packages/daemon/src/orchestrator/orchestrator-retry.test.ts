import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, mock, test } from "node:test";
import { type Actor, VersionConflictError } from "@togi/core";
import type Database from "better-sqlite3";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { createHandler } from "../commands/handle-command.ts";
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

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-orq-retry-"));
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
const sessions = () =>
  db.prepare("SELECT state, failure_reason FROM sessions ORDER BY rowid").all() as {
    state: string;
    failure_reason: string | null;
  }[];

test("tras un fallo, plan.retry_requested lanza otra sesión y, si completa, propone el plan v1", async () => {
  let failures = 1;
  const planner = new FakePlanner(() => failures-- > 0);
  const orchestrator = createOrchestrator({ db, store, handle, planner });
  orchestrator.start();
  const n = await submitted();
  await orchestrator.idle();
  assert.deepEqual(
    sessions().map((s) => s.failure_reason),
    ["planner_failed"],
  );
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM plans").get() as { n: number }).n, 0);

  const asked = await handle(human, { type: "requestPlanRetry", number: n });
  assert.ok("events" in asked, JSON.stringify(asked));
  await orchestrator.idle();

  assert.deepEqual(
    sessions().map((s) => s.failure_reason),
    ["planner_failed", null],
  );
  assert.equal(planner.calls.length, 2);
  assert.equal(
    (db.prepare("SELECT state FROM tasks WHERE number = ?").get(n) as { state: string }).state,
    "plan_review",
  );
  assert.equal((db.prepare("SELECT plan_version AS v FROM plans").get() as { v: number }).v, 1);
  await orchestrator.close();
});

test("la petición queda en el log con el humano, antes de la sesión nueva", async () => {
  let failures = 1;
  const planner = new FakePlanner(() => failures-- > 0);
  const orchestrator = createOrchestrator({ db, store, handle, planner });
  orchestrator.start();
  const n = await submitted();
  await orchestrator.idle();
  await handle(human, { type: "requestPlanRetry", number: n });
  await orchestrator.idle();
  const types: string[] = [];
  for await (const e of store.readStream(`task:${n}`)) types.push(e.type);
  const retry = types.indexOf("plan.retry_requested");
  assert.ok(retry > 0, types.join(","));
  assert.equal(types[retry + 1], "session.started");
  const actor = db
    .prepare("SELECT actor FROM events WHERE type = 'plan.retry_requested'")
    .get() as { actor: string };
  assert.deepEqual(JSON.parse(actor.actor), human);
  await orchestrator.close();
});

test("sin planificador, la petición se registra pero no se abre ninguna sesión", async () => {
  const orchestrator = createOrchestrator({ db, store, handle });
  orchestrator.start();
  const n = await submitted();
  const asked = await handle(human, { type: "requestPlanRetry", number: n });
  assert.ok("events" in asked);
  await orchestrator.idle();
  assert.deepEqual(sessions(), []);
  await orchestrator.close();
});

test("si el segundo intento de startSession también choca, queda en el log y la tarea sigue en planning", async () => {
  let conflicts = 2; // el intento y su reintento
  const racing = Object.assign(
    ((actor, cmd, opts) =>
      cmd.type === "startSession" && conflicts-- > 0
        ? Promise.reject(new VersionConflictError("task:1", 3, 4))
        : handle(actor, cmd, opts)) as typeof handle,
    { readText: handle.readText },
  );
  const log = mock.method(console, "error", () => {});
  try {
    const planner = new FakePlanner();
    const orchestrator = createOrchestrator({ db, store, handle: racing, planner });
    orchestrator.start();
    const n = await submitted();
    await orchestrator.idle();

    const lines = log.mock.calls.map((c) => String(c.arguments[0]));
    assert.ok(
      lines.some((l) => l.includes(`error planificando la tarea ${n}`) && l.includes("conflicto")),
      lines.join("\n"),
    );
    assert.deepEqual(sessions(), []); // no se abrió ninguna sesión
    assert.equal(planner.calls.length, 0); // y el planificador no llegó a lanzarse
    assert.equal(
      (db.prepare("SELECT state FROM tasks WHERE number = ?").get(n) as { state: string }).state,
      "planning",
    );

    // No queda atascada: la cola se vació y un nuevo reintento sí planifica.
    const asked = await handle(human, { type: "requestPlanRetry", number: n });
    assert.ok("events" in asked, JSON.stringify(asked));
    await orchestrator.idle();
    assert.equal(planner.calls.length, 1);
    await orchestrator.close();
  } finally {
    log.mock.restore();
  }
});

test("dos peticiones seguidas abren una sola sesión", async () => {
  const planner = new FakePlanner(() => true); // siempre falla: no queda plan que lo cambie
  const orchestrator = createOrchestrator({ db, store, handle, planner });
  orchestrator.start();
  const n = await submitted();
  await orchestrator.idle();
  assert.equal(sessions().length, 1);
  await handle(human, { type: "requestPlanRetry", number: n });
  await handle(human, { type: "requestPlanRetry", number: n });
  await orchestrator.idle();
  assert.equal(sessions().length, 2);
  await orchestrator.close();
});
