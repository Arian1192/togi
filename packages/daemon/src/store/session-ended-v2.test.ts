import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { Actor, NewEvent } from "@togi/core";
import Database from "better-sqlite3";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { createHandler } from "../commands/handle-command.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { rebuildProjections } from "../projections/index.ts";
import { AgentEventStore } from "../trajectory/agent-event-store.ts";
import { openEventDatabase } from "./database.ts";
import { SqliteEventStore } from "./event-store.ts";
import { MIGRATIONS, SCHEMA_V1_SQL, SCHEMA_VERSION } from "./schema.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "togi-ended2-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const human = { kind: "human", userId: "usr_1" } as const;
const system: Actor = { kind: "system", component: "adapter:planner" };
let clock = 0;
const ev = (type: string, payload: unknown, who: NewEvent["actor"] = human): NewEvent => ({
  type,
  schemaVersion: 1,
  actor: who,
  at: new Date(Date.UTC(2026, 10, 4, 10, 0, clock++)).toISOString(),
  payload,
});
const ref = (name: string) => ({ hash: `hmac-sha256:${name}`, keyId: "k", dataClass: "task_text" });
const usage = { inputTokens: 1, outputTokens: 2, estimatedCostUsd: 0.1, durationMs: 5 };

/** Una base en versión 10 cuyo log ya tiene una sesión fallida, guardada como session.ended v1. */
async function seedV10() {
  const path = join(dir, "togi.db");
  const old = new Database(path);
  old.exec(SCHEMA_V1_SQL);
  for (let v = 2; v <= 10; v++) old.exec(MIGRATIONS[v] as string);
  old.pragma("user_version = 10");
  await new SqliteEventStore(old).append("task:1", 0, [
    ev("task.created", {
      title: ref("t"),
      description: null,
      acceptanceCriteria: ref("c"),
      risk: "low",
      repo: "o/r",
      baseBranch: "main",
      source: { kind: "cli" },
    }),
    ev("task.submitted", {}),
    ev(
      "session.started",
      {
        sessionId: "ses_1",
        role: "planner",
        cycle: null,
        runtime: { id: "sdk", version: "1" },
        model: "m",
        specialist: { id: "generic-planner", version: 1, hash: "sha256:ab" },
        workspaceId: null,
        prompt: ref("p"),
        policy: ref("pol"),
      },
      system,
    ),
    // Sin motivo: la forma anterior a la versión 2.
    ev(
      "session.ended",
      { sessionId: "ses_1", outcome: "failed", usage, trajectoryEvents: 0 },
      system,
    ),
  ]);
  old.close();
  return path;
}

test("una base en versión 10 migra a la 11 con la columna del motivo, vacía en lo anterior", async () => {
  const db = openEventDatabase(await seedV10());
  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  rebuildProjections(db, new SqliteEventStore(db));
  assert.deepEqual(db.prepare("SELECT session_id, outcome, failure_reason FROM sessions").all(), [
    { session_id: "ses_1", outcome: "failed", failure_reason: null },
  ]);
  db.close();
});

test("un log con eventos v1 y v2 verifica íntegro: el hash se calcula sobre el evento guardado", async () => {
  const db = openEventDatabase(await seedV10());
  const store = new SqliteEventStore(db);
  rebuildProjections(db, store);
  const key = await loadOrCreateMasterKey(
    selectKeychain({ home: dir, env: { TOGI_KEYCHAIN: "file" } }),
  );
  const blobs = new FileBlobStore(join(dir, "blobs"), new DataKeyring(db, key));
  const handle = createHandler({ db, store, blobs });
  const agentEvents = new AgentEventStore(db, blobs);

  // Una sesión nueva sobre el mismo log: su session.ended se guarda en v2, con motivo.
  const start = await handle(system, {
    type: "startSession",
    number: 1,
    session: {
      sessionId: "ses_2",
      role: "planner",
      cycle: null,
      runtime: { id: "sdk", version: "1" },
      model: "m",
      specialist: { id: "generic-planner", version: 1, hash: "sha256:ab" },
      workspaceId: null,
      prompt: "p",
      policy: "pol",
    },
  });
  assert.ok("events" in start, JSON.stringify(start));
  await agentEvents.append("ses_2", 1, "message", { n: 1 });
  await agentEvents.append("ses_2", 1, "message", { n: 2 });
  const end = await handle(system, {
    type: "endSession",
    number: 1,
    session: {
      sessionId: "ses_2",
      outcome: "failed",
      usage,
      trajectoryEvents: 2,
      failureReason: "worker_died",
    },
  });
  assert.ok("events" in end, JSON.stringify(end));

  // Lo guardado no cambió: el v1 sigue en v1 y sin motivo; el nuevo, en v2 y con él.
  const rows = db
    .prepare(
      "SELECT schema_version AS v, payload FROM events WHERE type = 'session.ended' ORDER BY seq",
    )
    .all() as { v: number; payload: string }[];
  assert.deepEqual(
    rows.map((r) => [r.v, "failureReason" in JSON.parse(r.payload)]),
    [
      [1, false],
      [2, true],
    ],
  );
  assert.deepEqual(await store.verify(), { ok: true });
  assert.deepEqual(agentEvents.verify(), { ok: true });

  // Reconstruir desde el log mezclado da el motivo del v2 y nada del v1.
  rebuildProjections(db, store);
  assert.deepEqual(
    db.prepare("SELECT session_id, failure_reason FROM sessions ORDER BY started_at, rowid").all(),
    [
      { session_id: "ses_1", failure_reason: null },
      { session_id: "ses_2", failure_reason: "worker_died" },
    ],
  );
  db.close();
});
