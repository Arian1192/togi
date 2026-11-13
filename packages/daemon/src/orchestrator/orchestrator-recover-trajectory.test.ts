import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { Actor } from "@togi/core";
import type Database from "better-sqlite3";
import { hashToken } from "../auth/tokens.ts";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { type CreateTaskInput, createHandler } from "../commands/handle-command.ts";
import { paths } from "../config/app.ts";
import { createApp } from "../http/app.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { AgentEventStore } from "../trajectory/agent-event-store.ts";
import { createOrchestrator } from "./orchestrator.ts";

let home: string;
let db: Database.Database;
let store: SqliteEventStore;
let handle: ReturnType<typeof createHandler>;
let agentEvents: AgentEventStore;
let app: ReturnType<typeof createApp>;
const human: Actor = { kind: "human", userId: "usr_1" };
const system: Actor = { kind: "system", component: "adapter:planner" };
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
  home = mkdtempSync(join(tmpdir(), "togi-orq-recover-traj-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  store = new SqliteEventStore(db);
  const keys = new DataKeyring(
    db,
    await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } })),
  );
  const blobs = new FileBlobStore(p.blobs, keys);
  handle = createHandler({ db, store, blobs });
  agentEvents = new AgentEventStore(db, blobs);
  app = createApp(db, handle, { store, blobs, agentEvents });
  db.prepare("INSERT INTO users VALUES ('usr_1', 'owner', 'now')").run();
  db.prepare("INSERT INTO tokens VALUES (?, 'usr_1', 'now')").run(hashToken("tok"));
  db.prepare("INSERT INTO repos (repo, path, added_at) VALUES ('r', '/clon/r', 'now')").run();
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

/** Una tarea en planning con una sesión abierta y `events` eventos ya en su trayectoria. */
async function openSessionWith(events: number) {
  const made = await handle(human, task);
  assert.ok("number" in made);
  await handle(human, { type: "submit", number: made.number });
  await handle(system, {
    type: "startSession",
    number: made.number,
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
  for (let i = 0; i < events; i++)
    await agentEvents.append("ses_viejo", made.number, "message", { i });
}

/** El payload de cada session.ended del log. */
const ended = () =>
  (
    db.prepare("SELECT payload FROM events WHERE type = 'session.ended' ORDER BY seq").all() as {
      payload: string;
    }[]
  ).map((r) => {
    const p = JSON.parse(r.payload);
    return {
      sessionId: p.sessionId,
      trajectoryEvents: p.trajectoryEvents,
      reason: p.failureReason,
    };
  });
const agentRows = () =>
  (db.prepare("SELECT COUNT(*) AS n FROM agent_events").get() as { n: number }).n;
const verifyLog = async () => {
  const res = await app.request("/v1/admin/verify-log", {
    method: "POST",
    headers: { authorization: "Bearer tok" },
  });
  assert.equal(res.status, 200);
  return res.json();
};
const recover = () => createOrchestrator({ db, store, handle }).recover();

test("recover cierra la sesión con los eventos que ya tiene su trayectoria", async () => {
  await openSessionWith(3);
  await recover();
  assert.deepEqual(ended(), [
    { sessionId: "ses_viejo", trajectoryEvents: 3, reason: "daemon_restarted" },
  ]);
});

test("verify-log da ok tras recover y tras repetirlo", async () => {
  await openSessionWith(3);
  await recover();
  assert.deepEqual(await verifyLog(), { ok: true });
  await recover();
  assert.deepEqual(await verifyLog(), { ok: true });
});

test("repetir recover no duplica el cierre ni los eventos", async () => {
  await openSessionWith(3);
  await recover();
  await recover();
  assert.equal(ended().length, 1);
  assert.equal(agentRows(), 3);
});

test("una sesión abierta sin eventos se cierra con 0 y verify-log da ok", async () => {
  await openSessionWith(0);
  await recover();
  assert.deepEqual(ended(), [
    { sessionId: "ses_viejo", trajectoryEvents: 0, reason: "daemon_restarted" },
  ]);
  assert.deepEqual(await verifyLog(), { ok: true });
});
