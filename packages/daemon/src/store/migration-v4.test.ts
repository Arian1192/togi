import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { NewEvent } from "@togi/core";
import Database from "better-sqlite3";
import { openEventDatabase } from "./database.ts";
import { SqliteEventStore } from "./event-store.ts";
import { MIGRATIONS, SCHEMA_V1_SQL, SCHEMA_VERSION } from "./schema.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "togi-mig4-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("la migración 3→4 crea task_numbers, conserva los eventos y la cadena verifica", async () => {
  const path = join(dir, "togi.db");
  const old = new Database(path);
  old.exec(SCHEMA_V1_SQL);
  old.exec(MIGRATIONS[2] as string);
  old.exec(MIGRATIONS[3] as string);
  old.pragma("user_version = 3");
  const event = (n: number): NewEvent => ({
    type: "task.edited",
    schemaVersion: 1,
    actor: { kind: "human", userId: "usr_1" },
    at: "2026-11-03T10:00:00Z",
    payload: { n },
  });
  await new SqliteEventStore(old).append("task:1", 0, [event(1), event(2)]);
  old.close();

  const db = openEventDatabase(path);
  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  assert.equal((db.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n, 2);
  assert.deepEqual(await new SqliteEventStore(db).verify(), { ok: true });
  const reserve = db.prepare("INSERT INTO task_numbers (reserved_at) VALUES ('x')");
  assert.equal(reserve.run().lastInsertRowid, 1);
  db.close();
});
