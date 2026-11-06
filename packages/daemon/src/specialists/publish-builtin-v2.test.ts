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
  dir = mkdtempSync(join(tmpdir(), "togi-spec-v2-"));
  db = openEventDatabase(join(dir, "togi.db"));
  store = new SqliteEventStore(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const published = () =>
  db
    .prepare(
      "SELECT stream, payload FROM events WHERE type = 'specialist.version_published' ORDER BY seq",
    )
    .all() as { stream: string; payload: string }[];

test("publicar la 1 y la 2 añade dos eventos en el stream del especialista, sin lanzar", async () => {
  await publishBuiltinSpecialists(store, [genericPlanner, genericPlannerV2]);
  const rows = published();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.stream === "specialist:generic-planner"));
  assert.deepEqual(
    rows.map((r) => (JSON.parse(r.payload) as { hash: string }).hash),
    [specialistHash(genericPlanner), specialistHash(genericPlannerV2)],
  );
});

test("la 2 sobre una 1 ya publicada añade solo un evento, y repetirla no duplica", async () => {
  await publishBuiltinSpecialists(store, [genericPlanner]);
  await publishBuiltinSpecialists(store, [genericPlannerV2]);
  await publishBuiltinSpecialists(store, [genericPlanner, genericPlannerV2]);
  assert.equal(published().length, 2);
});
