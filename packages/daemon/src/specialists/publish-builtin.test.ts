import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { genericPlanner, specialistHash } from "@togi/core";
import type Database from "better-sqlite3";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { publishBuiltinSpecialists } from "./publish-builtin.ts";

let dir: string;
let db: Database.Database;
let store: SqliteEventStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "togi-spec-"));
  db = openEventDatabase(join(dir, "togi.db"));
  store = new SqliteEventStore(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const published = () =>
  db
    .prepare("SELECT stream, payload FROM events WHERE type = 'specialist.version_published'")
    .all() as { stream: string; payload: string }[];

test("publica generic-planner@1 con su contenido y su hash en su propio stream", async () => {
  await publishBuiltinSpecialists(store);
  const rows = published();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.stream, "specialist:generic-planner");
  assert.deepEqual(JSON.parse(rows[0]?.payload ?? ""), {
    specialist: genericPlanner,
    hash: specialistHash(genericPlanner),
  });
});

test("llamarla otra vez no duplica el evento", async () => {
  await publishBuiltinSpecialists(store);
  await publishBuiltinSpecialists(store);
  assert.equal(published().length, 1);
});

test("una versión nueva se añade sin tocar la anterior", async () => {
  await publishBuiltinSpecialists(store);
  const v2 = { ...genericPlanner, version: 2, instructions: "Otra." };
  await publishBuiltinSpecialists(store, [v2]);
  assert.equal(published().length, 2);
});

test("mismo id y versión con otro contenido: lanza y pide subir la versión, sin escribir", async () => {
  await publishBuiltinSpecialists(store);
  const changed = { ...genericPlanner, instructions: "Instrucciones nuevas." };
  await assert.rejects(
    () => publishBuiltinSpecialists(store, [changed]),
    /sube la versión de generic-planner/,
  );
  assert.equal(published().length, 1);
});

test("un especialista integrado que pide más que su rol no se publica", async () => {
  const bad = { ...genericPlanner, id: "malo", tools: ["Read", "Bash"] };
  await assert.rejects(() => publishBuiltinSpecialists(store, [bad]), /no admite las herramientas/);
  assert.equal(published().length, 0);
});

test("publicar no toca ningún stream de tarea", async () => {
  await publishBuiltinSpecialists(store);
  const other = db.prepare("SELECT COUNT(*) AS n FROM events WHERE stream LIKE 'task:%'").get() as {
    n: number;
  };
  assert.equal(other.n, 0);
});
