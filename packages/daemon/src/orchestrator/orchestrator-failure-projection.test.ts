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
import { planRoutes } from "../http/plans.ts";
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
const task: CreateTaskInput = {
  type: "create",
  title: "Filtro",
  description: "d",
  acceptanceCriteria: "criterio",
  risk: "low",
  repo: "r",
  baseBranch: "main",
  source: { kind: "cli" },
};

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-orq-proj-"));
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

/** Dos tareas con el mismo planificador: la 1 falla y la 2 completa. */
async function planTwo() {
  const orq = createOrchestrator({
    db,
    store,
    handle,
    planner: new FakePlanner((request) => request.taskNumber === 1),
  });
  orq.start();
  for (const _ of [1, 2]) {
    const made = await handle(human, task);
    assert.ok("number" in made);
    await handle(human, { type: "submit", number: made.number });
    await orq.idle();
  }
  await orq.close();
}

test("la proyección guarda el motivo de la fallida y null en la completada", async () => {
  await planTwo();
  assert.deepEqual(
    db
      .prepare(
        "SELECT task_number AS n, outcome, failure_reason AS reason FROM sessions ORDER BY n",
      )
      .all(),
    [
      { n: 1, outcome: "failed", reason: "planner_failed" },
      { n: 2, outcome: "completed", reason: null },
    ],
  );
});

test("GET /sessions devuelve failureReason en la fallida y null en la completada", async () => {
  await planTwo();
  const sessionsOf = async (n: number) => {
    const res = await planRoutes(db, undefined).request(`/v1/tasks/${n}/sessions`);
    const body = (await res.json()) as {
      sessions: { outcome: string; failureReason: string | null }[];
    };
    return body.sessions.map((s) => [s.outcome, s.failureReason]);
  };
  assert.deepEqual(await sessionsOf(1), [["failed", "planner_failed"]]);
  assert.deepEqual(await sessionsOf(2), [["completed", null]]);
});

test("una sesión fallida sin repo registrado guarda repo_not_registered en la proyección", async () => {
  db.prepare("DELETE FROM repos").run();
  const orq = createOrchestrator({ db, store, handle, planner: new FakePlanner() });
  orq.start();
  const made = await handle(human, task);
  assert.ok("number" in made);
  await handle(human, { type: "submit", number: made.number });
  await orq.idle();
  await orq.close();
  assert.deepEqual(db.prepare("SELECT failure_reason AS reason FROM sessions").all(), [
    { reason: "repo_not_registered" },
  ]);
});
