import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { type NewEvent, toDomainEvent } from "@togi/core";
import type Database from "better-sqlite3";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { applyToTasks, rebuildTasks } from "./tasks.ts";

let dir: string;
let db: Database.Database;
let store: SqliteEventStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "togi-crit-"));
  db = openEventDatabase(join(dir, "togi.db"));
  store = new SqliteEventStore(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

let clock = 0;
const ev = (type: string, payload: unknown): NewEvent => ({
  type,
  schemaVersion: 1,
  actor: { kind: "human", userId: "usr_1" },
  at: `2026-11-03T10:00:${String(clock++).padStart(2, "0")}Z`,
  payload,
});
const ref = (name: string) => ({ hash: `hmac-sha256:${name}`, keyId: "k", dataClass: "task_text" });
const created = (criteria: boolean) =>
  ev("task.created", {
    title: ref("t"),
    description: null,
    acceptanceCriteria: criteria ? ref("c") : null,
    risk: "low",
    repo: "r",
    baseBranch: "main",
    source: { kind: "cli" },
  });
let version = 0;
const append = (events: NewEvent[]) => {
  store.appendWithin("task:1", version, events, (stored, tx) => {
    for (const s of stored) applyToTasks(tx, toDomainEvent(s));
  });
  version += events.length;
};
const flag = () =>
  (db.prepare("SELECT has_criteria AS f FROM tasks WHERE number = 1").get() as { f: number }).f;

beforeEach(() => {
  version = 0;
});

test("has_criteria: false al crear sin criterio, true al editarlo, false al vaciarlo", () => {
  append([created(false)]);
  assert.equal(flag(), 0);
  append([ev("task.edited", { acceptanceCriteria: ref("c") })]);
  assert.equal(flag(), 1);
  append([ev("task.edited", { title: ref("otro") })]);
  assert.equal(flag(), 1, "una edición sin criterio no lo cambia");
  append([ev("task.edited", { acceptanceCriteria: null })]);
  assert.equal(flag(), 0);
});

test("has_criteria: true al crear con criterio, y rebuildTasks da lo mismo que el camino incremental", () => {
  append([
    created(true),
    ev("task.edited", { acceptanceCriteria: null }),
    ev("task.submitted", {}),
  ]);
  const incremental = db.prepare("SELECT * FROM tasks").all();
  rebuildTasks(db, store, 1);
  assert.deepEqual(db.prepare("SELECT * FROM tasks").all(), incremental);
  assert.equal(flag(), 0);
});
