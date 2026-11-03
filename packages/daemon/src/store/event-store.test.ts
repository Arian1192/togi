import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { GENESIS_HASH, type NewEvent, VersionConflictError } from "@togi/core";
import type Database from "better-sqlite3";
import { openEventDatabase } from "./database.ts";
import { SqliteEventStore } from "./event-store.ts";

let dir: string;
let db: Database.Database;
let store: SqliteEventStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "togi-es-"));
  db = openEventDatabase(join(dir, "togi.db"));
  store = new SqliteEventStore(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const event = (n: number, extra: Partial<NewEvent> = {}): NewEvent => ({
  type: "task.edited",
  schemaVersion: 1,
  actor: { kind: "human", userId: "usr_1" },
  at: "2026-11-03T10:00:00Z",
  payload: { n },
  ...extra,
});

const rows = (sql = "SELECT * FROM events ORDER BY seq") =>
  db.prepare(sql).all() as Record<string, unknown>[];
const count = (table = "events") =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

test("append asigna seq global y streamVersion por stream, y encadena los hashes", async () => {
  const first = await store.append("task:1", 0, [event(1), event(2)]);
  await store.append("task:2", 0, [event(3)]);
  await store.append("task:1", 2, [event(4)]);

  assert.deepEqual(
    rows().map((r) => [r.seq, r.stream, r.stream_version]),
    [
      [1, "task:1", 1],
      [2, "task:1", 2],
      [3, "task:2", 1],
      [4, "task:1", 3],
    ],
  );
  const all = rows();
  assert.equal(all[0]?.prev_hash, GENESIS_HASH);
  for (const [i, row] of all.slice(1).entries()) {
    assert.equal(row.prev_hash, all[i]?.hash);
  }
  assert.deepEqual(
    first.map((e) => e.hash),
    all.slice(0, 2).map((r) => r.hash),
  );
});

test("guarda actor y payload como JSON y correlation_id como NULL cuando falta", async () => {
  await store.append("task:1", 0, [event(1), event(2, { correlationId: "req_1" })]);
  const [a, b] = rows();
  assert.equal(a?.actor, '{"kind":"human","userId":"usr_1"}');
  assert.equal(a?.payload, '{"n":1}');
  assert.equal(a?.correlation_id, null);
  assert.equal(b?.correlation_id, "req_1");
});

test("un undefined dentro del payload no se guarda ni entra en el hash", async () => {
  const [stored] = await store.append("task:1", 0, [event(1, { payload: { a: undefined, b: 1 } })]);
  assert.deepEqual(stored?.payload, { b: 1 });
  assert.equal(rows()[0]?.payload, '{"b":1}');
});

test("un stream inexistente tiene versión 0 y una lista vacía lanza sin escribir", async () => {
  await assert.rejects(store.append("task:1", 1, [event(1)]), (error: unknown) => {
    assert.ok(error instanceof VersionConflictError);
    assert.equal(error.actualVersion, 0);
    return true;
  });
  await assert.rejects(store.append("task:1", 0, []), RangeError);
  assert.equal(count(), 0);
  assert.equal((await store.append("task:1", 0, [event(1)]))[0]?.streamVersion, 1);
});

test("el conflicto de versión lanza VersionConflictError y no escribe nada", async () => {
  await store.append("task:1", 0, [event(1), event(2)]);
  await assert.rejects(store.append("task:1", 1, [event(3)]), (error: unknown) => {
    assert.ok(error instanceof VersionConflictError);
    assert.equal(error.stream, "task:1");
    assert.equal(error.expectedVersion, 1);
    assert.equal(error.actualVersion, 2);
    return true;
  });
  assert.equal(count(), 2);
  assert.equal((await store.append("task:1", 2, [event(3)]))[0]?.seq, 3);
});

test("appendWithin ejecuta el callback en la misma transacción", () => {
  db.exec("CREATE TABLE projection (seq INTEGER)");
  let seenInside = 0;
  const stored = store.appendWithin("task:1", 0, [event(1), event(2)], (events, tx) => {
    seenInside = (tx.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n;
    for (const e of events) tx.prepare("INSERT INTO projection VALUES (?)").run(e.seq);
  });
  assert.equal(seenInside, 2);
  assert.equal(stored.length, 2);
  assert.equal(count("projection"), 2);
});

test("si el callback de appendWithin lanza, se revierte el evento y lo que escribió", async () => {
  db.exec("CREATE TABLE projection (seq INTEGER)");
  const boom = new Error("boom");
  assert.throws(
    () =>
      store.appendWithin("task:1", 0, [event(1)], (events, tx) => {
        tx.prepare("INSERT INTO projection VALUES (?)").run(events[0]?.seq);
        throw boom;
      }),
    (error: unknown) => error === boom,
  );
  assert.equal(count(), 0);
  assert.equal(count("projection"), 0);
  assert.equal((await store.append("task:1", 0, [event(1)]))[0]?.seq, 1);
});
