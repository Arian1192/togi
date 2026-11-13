import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { Actor, SessionId } from "@togi/core";
import type Database from "better-sqlite3";
import { hashToken } from "../auth/tokens.ts";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { createHandler } from "../commands/handle-command.ts";
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

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-orq-recover-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  db.prepare("INSERT INTO users VALUES ('usr_1', 'owner', 'now')").run();
  db.prepare("INSERT INTO tokens VALUES (?, 'usr_1', 'now')").run(hashToken("tok"));
  const keys = new DataKeyring(
    db,
    await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } })),
  );
  const blobs = new FileBlobStore(p.blobs, keys);
  store = new SqliteEventStore(db);
  handle = createHandler({ db, store, blobs });
  agentEvents = new AgentEventStore(db, blobs);
  app = createApp(db, handle, { store, blobs, agentEvents });
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

/** Una tarea en planning con una sesión que quedó abierta y `events` eventos de trayectoria. */
async function openSession(sessionId: SessionId, events: number): Promise<number> {
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
  await handle(system, {
    type: "startSession",
    number: made.number,
    session: {
      sessionId,
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
    await agentEvents.append(sessionId, made.number, "message", { i });
  return made.number;
}

/** Los `session.ended` del log para una sesión. */
const ended = (sessionId: string) =>
  (
    db.prepare("SELECT payload FROM events WHERE type = 'session.ended' ORDER BY seq").all() as {
      payload: string;
    }[]
  )
    .map((r) => JSON.parse(r.payload))
    .filter((p) => p.sessionId === sessionId);

/** La misma ruta que usa `togi admin verify-log`. */
const verifyLog = async () =>
  (
    await app.request("/v1/admin/verify-log", {
      method: "POST",
      headers: { authorization: "Bearer tok" },
    })
  ).json();

const recover = async () => {
  const orq = createOrchestrator({ db, store, handle });
  await orq.recover();
  await orq.close();
};

test("recover cierra la sesión abierta con el recuento real de su trayectoria", async () => {
  await openSession("ses_viejo", 3);
  await recover();
  const [payload] = ended("ses_viejo");
  assert.equal(payload.trajectoryEvents, 3);
  assert.equal(payload.failureReason, "daemon_restarted");
});

test("verify-log da ok tras recover y tras un segundo recover", async () => {
  await openSession("ses_viejo", 3);
  await recover();
  assert.deepEqual(await verifyLog(), { ok: true });
  await recover();
  assert.deepEqual(await verifyLog(), { ok: true });
});

test("dos recover seguidos dejan un solo session.ended y la trayectoria intacta", async () => {
  await openSession("ses_viejo", 3);
  await recover();
  await recover();
  assert.equal(ended("ses_viejo").length, 1);
  const rows = db
    .prepare("SELECT COUNT(*) AS n FROM agent_events WHERE session_id = 'ses_viejo'")
    .get() as { n: number };
  assert.equal(rows.n, 3);
});

test("una sesión abierta sin eventos se cierra con 0 y verify-log da ok", async () => {
  await openSession("ses_vacio", 0);
  await recover();
  assert.equal(ended("ses_vacio")[0].trajectoryEvents, 0);
  assert.deepEqual(await verifyLog(), { ok: true });
});
