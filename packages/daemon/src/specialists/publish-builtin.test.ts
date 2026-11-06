import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { genericPlanner, genericPlannerV2, specialistHash } from "@togi/core";
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

test("publica generic-planner@1 y @2 con su contenido y su hash en su propio stream", async () => {
  await publishBuiltinSpecialists(store);
  const rows = published();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.stream === "specialist:generic-planner"));
  assert.deepEqual(
    rows.map((r) => JSON.parse(r.payload)),
    [genericPlanner, genericPlannerV2].map((specialist) => ({
      specialist,
      hash: specialistHash(specialist),
    })),
  );
});

test("llamarla otra vez no duplica los eventos", async () => {
  await publishBuiltinSpecialists(store);
  await publishBuiltinSpecialists(store);
  assert.equal(published().length, 2);
});

test("una versión nueva se añade sin tocar las anteriores", async () => {
  await publishBuiltinSpecialists(store);
  const v3 = { ...genericPlanner, version: 3, instructions: "Otra." };
  await publishBuiltinSpecialists(store, [v3]);
  assert.equal(published().length, 3);
});

test("mismo id y versión con otro contenido: lanza y pide subir la versión, sin escribir", async () => {
  await publishBuiltinSpecialists(store);
  const changed = { ...genericPlanner, instructions: "Instrucciones nuevas." };
  await assert.rejects(
    () => publishBuiltinSpecialists(store, [changed]),
    /sube la versión de generic-planner/,
  );
  assert.equal(published().length, 2);
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
