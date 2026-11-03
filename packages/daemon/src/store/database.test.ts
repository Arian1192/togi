import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { openEventDatabase } from "./database.ts";

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

test("reabrir conserva los datos y user_version es 1", () => {
  const path = join(dir, "togi.db");
  openEventDatabase(path).exec(row);
  const db = openEventDatabase(path);
  assert.equal(db.pragma("user_version", { simple: true }), 1);
  assert.equal((db.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n, 1);
  db.pragma("user_version = 2");
  db.close();
  assert.throws(() => openEventDatabase(path), /esquema 2/);
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
