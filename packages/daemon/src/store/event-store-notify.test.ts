import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { NewEvent, StoredEvent } from "@togi/core";
import type Database from "better-sqlite3";
import { openEventDatabase } from "./database.ts";
import { SqliteEventStore } from "./event-store.ts";

let dir: string;
let db: Database.Database;
let store: SqliteEventStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "togi-notify-"));
  db = openEventDatabase(join(dir, "togi.db"));
  store = new SqliteEventStore(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const event = (n: number): NewEvent => ({
  type: "task.edited",
  schemaVersion: 1,
  actor: { kind: "human", userId: "usr_1" },
  at: "2026-11-03T10:00:00Z",
  payload: { n },
});

test("avisa de cada evento en orden, ya confirmado en la base de datos", async () => {
  const seen: [number, number][] = [];
  store.subscribe((e) => {
    const committed = (db.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n;
    seen.push([e.seq, committed]);
  });
  await store.append("task:1", 0, [event(1), event(2)]);
  assert.deepEqual(seen, [
    [1, 2],
    [2, 2],
  ]);
});

test("un append que se deshace no avisa de nada", () => {
  const seen: StoredEvent[] = [];
  store.subscribe((e) => seen.push(e));
  assert.throws(() =>
    store.appendWithin("task:1", 0, [event(1)], () => {
      throw new Error("proyección rota");
    }),
  );
  assert.deepEqual(seen, []);
});

test("un listener que lanza no hace fallar el append y los demás reciben el evento", async () => {
  const log = mock.method(console, "error", () => {});
  const received: number[] = [];
  store.subscribe(() => {
    throw new Error("suscriptor roto");
  });
  store.subscribe((e) => received.push(e.seq));
  const stored = await store.append("task:1", 0, [event(1)]);
  log.mock.restore();
  assert.equal(stored.length, 1);
  assert.deepEqual(received, [1]);
  assert.equal(log.mock.callCount(), 1);
});

test("darse de baja deja de avisar y libera el listener", async () => {
  const received: number[] = [];
  const off = store.subscribe((e) => received.push(e.seq));
  assert.equal(store.subscriberCount(), 1);
  off();
  assert.equal(store.subscriberCount(), 0);
  await store.append("task:1", 0, [event(1)]);
  assert.deepEqual(received, []);
});

test("appendWithin dentro de otra transacción lanza y no escribe ni avisa", () => {
  const received: number[] = [];
  store.subscribe((e) => received.push(e.seq));
  assert.throws(
    () => db.transaction(() => store.appendWithin("task:1", 0, [event(1)], () => {}))(),
    /dentro de otra transacción/,
  );
  assert.equal((db.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n, 0);
  assert.deepEqual(received, []);
});
