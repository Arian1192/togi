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
  dir = mkdtempSync(join(tmpdir(), "togi-mig6-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("la migración 5→6 crea idempotency_keys, conserva los eventos y la cadena verifica", async () => {
  const path = join(dir, "togi.db");
  const old = new Database(path);
  old.exec(SCHEMA_V1_SQL);
  for (let v = 2; v <= 5; v++) old.exec(MIGRATIONS[v] as string);
  old.pragma("user_version = 5");
  const event: NewEvent = {
    type: "task.edited",
    schemaVersion: 1,
    actor: { kind: "human", userId: "usr_1" },
    at: "2026-11-03T10:00:00Z",
    payload: {},
  };
  await new SqliteEventStore(old).append("task:1", 0, [event]);
  old.close();

  const db = openEventDatabase(path);
  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  assert.deepEqual(await new SqliteEventStore(db).verify(), { ok: true });
  const insert = db.prepare("INSERT INTO idempotency_keys VALUES (?, ?, 'h', 201, '{}', 'now')");
  insert.run("usr_1", "k");
  insert.run("usr_2", "k"); // la clave es por usuario
  assert.throws(() => insert.run("usr_1", "k"), { code: "SQLITE_CONSTRAINT_PRIMARYKEY" });
  db.close();
});
