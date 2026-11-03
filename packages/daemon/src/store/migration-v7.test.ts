import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import Database from "better-sqlite3";
import { openEventDatabase } from "./database.ts";
import { MIGRATIONS, SCHEMA_V1_SQL, SCHEMA_VERSION } from "./schema.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "togi-mig7-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("la migración 6→7 vacía la proyección tasks, que ya no guarda títulos en claro", () => {
  const path = join(dir, "togi.db");
  const old = new Database(path);
  old.exec(SCHEMA_V1_SQL);
  for (let v = 2; v <= 6; v++) old.exec(MIGRATIONS[v] as string);
  old.pragma("user_version = 6");
  old
    .prepare("INSERT INTO tasks VALUES (1, 'Filtro', 'draft', 'low', 'r', 'main', 1, 'now', 'now')")
    .run();
  old.close();

  const db = openEventDatabase(path);
  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  assert.equal((db.prepare("SELECT count(*) AS n FROM tasks").get() as { n: number }).n, 0);
  db.close();
});
