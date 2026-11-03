import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { NewEvent, StoredEvent } from "@togi/core";
import type Database from "better-sqlite3";
import { openEventDatabase } from "./database.ts";
import { SqliteEventStore } from "./event-store.ts";

let dir: string;
let db: Database.Database;
let store: SqliteEventStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "togi-es-read-"));
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

async function collect(items: AsyncIterable<StoredEvent>): Promise<StoredEvent[]> {
  const out: StoredEvent[] = [];
  for await (const item of items) out.push(item);
  return out;
}

const withoutTriggers = () => {
  db.exec("DROP TRIGGER events_no_update; DROP TRIGGER events_no_delete");
};

test("readAll y readStream devuelven lo escrito, en orden y con filtros", async () => {
  const written = await store.append("task:1", 0, [event(1), event(2)]);
  await store.append("task:2", 0, [event(3)]);
  await store.append("task:1", 2, [event(4)]);

  const all = await collect(store.readAll());
  assert.deepEqual(
    all.map((e) => [e.seq, e.stream, e.streamVersion]),
    [
      [1, "task:1", 1],
      [2, "task:1", 2],
      [3, "task:2", 1],
      [4, "task:1", 3],
    ],
  );
  assert.deepEqual(all[0], written[0]);
  assert.deepEqual(
    (await collect(store.readStream("task:1"))).map((e) => e.seq),
    [1, 2, 4],
  );
  assert.deepEqual(
    (await collect(store.readStream("task:1", 2))).map((e) => e.seq),
    [2, 4],
  );
  assert.deepEqual(
    (await collect(store.readAll(3))).map((e) => e.seq),
    [3, 4],
  );
  assert.deepEqual(await collect(store.readStream("task:9")), []);
});

test("correlation_id NULL se lee como campo ausente y verify da verde con y sin él", async () => {
  await store.append("task:1", 0, [event(1), event(2, { correlationId: "req_1" })]);
  await store.append("task:1", 2, [event(3)]);
  const all = await collect(store.readAll());
  assert.equal(Object.hasOwn(all[0] ?? {}, "correlationId"), false);
  assert.equal(all[1]?.correlationId, "req_1");
  assert.deepEqual(await store.verify(), { ok: true });
});

test("verify sobre un log vacío da verde", async () => {
  assert.deepEqual(await store.verify(), { ok: true });
});

test("un undefined dentro del payload se lee sin él y verify da verde", async () => {
  await store.append("task:1", 0, [event(1, { payload: { a: undefined, b: 1 } })]);
  assert.deepEqual((await collect(store.readAll()))[0]?.payload, { b: 1 });
  assert.deepEqual(await store.verify(), { ok: true });
});

test("verify detecta un payload alterado con brokenAt exacto", async () => {
  await store.append("task:1", 0, [event(1), event(2), event(3)]);
  withoutTriggers();
  db.prepare("UPDATE events SET payload = '{\"n\":99}' WHERE seq = 2").run();
  assert.deepEqual(await store.verify(), { ok: false, brokenAt: 2 });
});

test("verify detecta una fila borrada con brokenAt exacto", async () => {
  await store.append("task:1", 0, [event(1), event(2), event(3)]);
  withoutTriggers();
  db.prepare("DELETE FROM events WHERE seq = 2").run();
  assert.deepEqual(await store.verify(), { ok: false, brokenAt: 2 });
});

test("verify detecta un prev_hash alterado", async () => {
  await store.append("task:1", 0, [event(1), event(2), event(3)]);
  withoutTriggers();
  db.prepare("UPDATE events SET prev_hash = ? WHERE seq = 3").run("f".repeat(64));
  assert.deepEqual(await store.verify(), { ok: false, brokenAt: 3 });
});

test("la lectura por lotes cruza el límite de 500 y conserva el orden", async () => {
  const many = Array.from({ length: 1001 }, (_, i) => event(i));
  await store.append("task:1", 0, many);
  const all = await collect(store.readAll());
  assert.deepEqual(
    all.map((e) => e.seq),
    many.map((_, i) => i + 1),
  );
  assert.equal((await collect(store.readStream("task:1", 1000))).length, 2);
  assert.deepEqual(await store.verify(), { ok: true });
});
