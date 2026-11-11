import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { type NewEvent, repoStream } from "@togi/core";
import Database from "better-sqlite3";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { MIGRATIONS, SCHEMA_V1_SQL } from "../store/schema.ts";
import { rebuildProjections } from "./index.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "togi-repo-profiles-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const profile = (lint: string | null) => ({
  install: "pnpm install --frozen-lockfile",
  checks: { typecheck: "pnpm typecheck", lint, test: "pnpm test" },
  testFiles: ["apps/**/*.test.ts"],
  protectedPaths: [],
  docs: ["docs/**"],
  registry: ["registry.npmjs.org"],
  testExclude: [],
});
const set = (lint: string | null, at: string): NewEvent => ({
  type: "repo.profile_set",
  schemaVersion: 1,
  actor: { kind: "human", userId: "usr_1" },
  at,
  payload: { repo: "Arian1192/promos", profile: profile(lint) },
});
const rows = (db: Database.Database) => db.prepare("SELECT * FROM repo_profiles").all();
const expected = [
  {
    repo: "Arian1192/promos",
    profile: JSON.stringify(profile("pnpm lint")),
    stream_version: 2,
    set_at: "2026-11-11T11:00:00Z",
  },
];

test("la reconstrucción deja el último perfil de cada repo", async () => {
  const db = openEventDatabase(join(dir, "togi.db"));
  const store = new SqliteEventStore(db);
  await store.append(repoStream("Arian1192/promos"), 0, [
    set(null, "2026-11-11T10:00:00Z"),
    set("pnpm lint", "2026-11-11T11:00:00Z"),
  ]);
  rebuildProjections(db, store);
  assert.deepEqual(rows(db), expected);
  db.close();
});

test("la migración 11→12 crea repo_profiles y la llena desde el log", async () => {
  const path = join(dir, "togi.db");
  const old = new Database(path);
  old.exec(SCHEMA_V1_SQL);
  for (let v = 2; v <= 11; v++) old.exec(MIGRATIONS[v] as string);
  old.pragma("user_version = 11");
  await new SqliteEventStore(old).append(repoStream("Arian1192/promos"), 0, [
    set(null, "2026-11-11T10:00:00Z"),
    set("pnpm lint", "2026-11-11T11:00:00Z"),
  ]);
  old.close();

  const db = openEventDatabase(path);
  assert.deepEqual(rows(db), expected);
  db.close();
});
