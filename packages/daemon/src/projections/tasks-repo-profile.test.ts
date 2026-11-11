import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { repoStream } from "@togi/core";
import type Database from "better-sqlite3";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { rebuildProjections } from "./index.ts";

let dir: string;
let db: Database.Database;
let store: SqliteEventStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "togi-repo-profile-"));
  db = openEventDatabase(join(dir, "togi.db"));
  store = new SqliteEventStore(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const profile = {
  install: "pnpm install --frozen-lockfile",
  checks: { typecheck: "pnpm typecheck", lint: null, test: "pnpm test" },
  testFiles: ["apps/**/*.test.ts"],
  protectedPaths: [],
  docs: ["docs/**"],
  registry: ["registry.npmjs.org"],
  testExclude: [],
};

test("un perfil del repo en el log no rompe la reconstrucción ni crea tareas", async () => {
  await store.append(repoStream("Arian1192/promos"), 0, [
    {
      type: "repo.profile_set",
      schemaVersion: 1,
      actor: { kind: "human", userId: "usr_1" },
      at: "2026-11-11T10:00:00Z",
      payload: { repo: "Arian1192/promos", profile },
    },
  ]);
  rebuildProjections(db, store);
  assert.deepEqual(db.prepare("SELECT * FROM tasks").all(), []);
});
