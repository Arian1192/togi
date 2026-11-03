import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { NewEvent } from "@togi/core";
import Database from "better-sqlite3";
import { openEventDatabase } from "./database.ts";
import { SqliteEventStore } from "./event-store.ts";
import { SCHEMA_V1_SQL, SCHEMA_VERSION } from "./schema.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "togi-db-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const row = `INSERT INTO events (stream, stream_version, type, schema_version, actor, at, payload, prev_hash, hash)
  VALUES ('task:1', 1, 't', 1, '{}', '2026-11-03T10:00:00Z', '{}', 'p', 'h')`;
const agentRow = `INSERT INTO agent_events (session_id, seq, at, kind, payload, prev_hash, hash)
  VALUES ('ses_1', 1, '2026-11-03T10:00:00Z', 'message', '{}', 'p', 'h')`;

test("los triggers rechazan UPDATE y DELETE en events y agent_events", () => {
  const db = openEventDatabase(join(dir, "data", "togi.db"));
  db.exec(row);
  db.exec(agentRow);
  for (const sql of [
    "UPDATE events SET type = 'x'",
    "DELETE FROM events",
    "UPDATE agent_events SET kind = 'x'",
    "DELETE FROM agent_events",
  ]) {
    assert.throws(() => db.exec(sql), /append-only/, sql);
  }
  db.close();
});

test("reabrir conserva los datos y user_version es SCHEMA_VERSION", () => {
  const path = join(dir, "togi.db");
  openEventDatabase(path).exec(row);
  const db = openEventDatabase(path);
  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  assert.equal((db.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n, 1);
  db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
  db.close();
  assert.throws(() => openEventDatabase(path), new RegExp(`esquema ${SCHEMA_VERSION + 1}`));
});

test("la base, -wal y -shm son 0600 y el directorio 0700", () => {
  const path = join(dir, "data", "togi.db");
  const db = openEventDatabase(path);
  db.exec(row);
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    assert.equal(statSync(file).mode & 0o777, 0o600, file);
  }
  assert.equal(statSync(join(dir, "data")).mode & 0o777, 0o700);
  db.close();
});

const hasTable = (db: Database.Database, name: string) =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(name) !== undefined;

async function createV1(path: string): Promise<void> {
  const old = new Database(path);
  old.exec(SCHEMA_V1_SQL);
  old.pragma("user_version = 1");
  const store = new SqliteEventStore(old);
  const event = (n: number): NewEvent => ({
    type: "task.edited",
    schemaVersion: 1,
    actor: { kind: "human", userId: "usr_1" },
    at: "2026-11-03T10:00:00Z",
    payload: { n },
  });
  await store.append("task:1", 0, [event(1), event(2)]);
  old.close();
}

test("una base nueva queda en la versión 2 con data_keys sin triggers", () => {
  const db = openEventDatabase(join(dir, "togi.db"));
  assert.equal(SCHEMA_VERSION, 2);
  assert.equal(db.pragma("user_version", { simple: true }), 2);
  db.exec("INSERT INTO data_keys VALUES ('k1', 7, 'prompt', x'00', '2026-11-03T10:00:00Z')");
  assert.throws(() => db.exec("INSERT INTO data_keys VALUES ('k2', 7, 'prompt', x'00', 'x')"));
  db.exec("DELETE FROM data_keys");
  db.close();
});

test("la migración 1→2 conserva los eventos y la cadena verifica", async () => {
  const path = join(dir, "togi.db");
  await createV1(path);
  const db = openEventDatabase(path);
  assert.equal(db.pragma("user_version", { simple: true }), 2);
  assert.ok(hasTable(db, "data_keys"));
  assert.equal((db.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n, 2);
  assert.deepEqual(await new SqliteEventStore(db).verify(), { ok: true });
  db.close();
});

test("una migración fallida se revierte: versión 1, sin data_keys y con los eventos", async () => {
  const path = join(dir, "togi.db");
  await createV1(path);
  const bad = { 2: "CREATE TABLE data_keys (key_id TEXT); NO ES SQL;" };
  assert.throws(() => openEventDatabase(path, bad));
  const raw = new Database(path);
  assert.equal(raw.pragma("user_version", { simple: true }), 1);
  assert.equal(hasTable(raw, "data_keys"), false);
  assert.equal((raw.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n, 2);
  raw.close();
});
