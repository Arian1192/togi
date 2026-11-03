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
  dir = mkdtempSync(join(tmpdir(), "togi-tasks-"));
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
const created = (title: string) =>
  ev("task.created", {
    title: ref(title),
    description: null,
    acceptanceCriteria: null,
    risk: "low",
    repo: "r",
    baseBranch: "main",
    source: { kind: "cli" },
  });
const rejected = () =>
  ev("task.rejected", {
    reason: {
      category: "scope",
      text: { hash: "hmac-sha256:ab", keyId: "k", dataClass: "task_text" },
    },
  });

/** Camino incremental: el append y la proyección en la misma transacción. */
const append = (stream: string, expected: number, events: NewEvent[]) =>
  store.appendWithin(stream, expected, events, (stored, tx) => {
    for (const s of stored) applyToTasks(tx, toDomainEvent(s));
  });
const table = () => db.prepare("SELECT * FROM tasks ORDER BY number").all();

test("crear → editar → enviar → rechazar deja la fila esperada", () => {
  append("task:1", 0, [
    created("a"),
    ev("task.edited", { title: ref("b") }),
    ev("task.submitted", {}),
    rejected(),
  ]);
  const [row] = table() as Record<string, unknown>[];
  assert.deepEqual(JSON.parse(String(row?.title)), ref("b"));
  const { title: _title, ...rest } = row ?? {};
  assert.deepEqual(rest, {
    number: 1,
    state: "rejected",
    risk: "low",
    repo: "r",
    base_branch: "main",
    has_criteria: 0,
    stream_version: 4,
    created_at: "2026-11-03T10:00:00Z",
    updated_at: "2026-11-03T10:00:03Z",
  });
});

test("data.erased no cambia la tabla", () => {
  append("task:1", 0, [created("a")]);
  const before = table();
  append("admin", 0, [
    ev("data.erased", { keyId: "k", taskId: 1, dataClass: "prompt", reason: "rgpd" }),
  ]);
  assert.deepEqual(table(), before);
});

test("un evento sobre una tarea inexistente lanza", () => {
  assert.throws(() => append("task:9", 0, [ev("task.submitted", {})]), /tarea 9 sin fila/);
  assert.deepEqual(table(), []);
});

test("rebuildTasks da la misma tabla que la aplicación incremental", () => {
  append("task:1", 0, [created("a"), ev("task.submitted", {})]);
  append("task:2", 0, [created("c")]);
  append("task:1", 2, [ev("task.edited", { title: ref("b") }), rejected()]);
  append("task:2", 1, [ev("task.edited", { title: ref("d") })]);
  const incremental = table();
  for (const batchSize of [1, 2, 500]) {
    rebuildTasks(db, store, batchSize);
    assert.deepEqual(table(), incremental, `lote ${batchSize}`);
  }
});
