import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoredEvent } from "../ports/event-store.ts";
import { GENESIS_HASH, hashEvent } from "./hash.ts";
import { verifyChain } from "./verify.ts";

function chain(length: number): StoredEvent[] {
  const events: StoredEvent[] = [];
  let prevHash = GENESIS_HASH;
  for (let seq = 1; seq <= length; seq++) {
    const envelope = {
      seq,
      stream: "task:1",
      streamVersion: seq,
      type: "task.event",
      schemaVersion: 1,
      actor: { kind: "human" as const, userId: "usr_1" as const },
      at: "2026-11-03T10:00:00Z",
      payload: { n: seq },
    };
    const hash = hashEvent(prevHash, envelope);
    events.push({ ...envelope, prevHash, hash });
    prevHash = hash;
  }
  return events;
}

async function* asyncOf<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

function withPatch(
  events: StoredEvent[],
  index: number,
  patch: Partial<StoredEvent>,
): StoredEvent[] {
  return events.map((event, i) => (i === index ? { ...event, ...patch } : event));
}

const broken = (seq: number) => ({ ok: false, brokenAt: seq });

test("cadena vacía, de 1 y de N eventos: ok, con Iterable y AsyncIterable", async () => {
  for (const length of [0, 1, 5]) {
    assert.deepEqual(await verifyChain(chain(length)), { ok: true });
    assert.deepEqual(await verifyChain(asyncOf(chain(length))), { ok: true });
  }
});

const alterations: [string, (events: StoredEvent[]) => StoredEvent[], number][] = [
  ["payload alterado", (e) => withPatch(e, 2, { payload: { n: 99 } }), 3],
  [
    "hash reescrito sin recalcular los siguientes",
    (e) => withPatch(e, 1, { hash: "f".repeat(64) }),
    2,
  ],
  ["primer prevHash distinto del génesis", (e) => withPatch(e, 0, { prevHash: "1".repeat(64) }), 1],
  ["evento borrado", (e) => e.filter((_, i) => i !== 2), 3],
  ["seq que no empieza en 1", (e) => e.slice(1), 1],
  ["evento duplicado", (e) => [e[0], e[0], e[1]] as StoredEvent[], 2],
  ["eventos reordenados", (e) => [e[0], e[2], e[1]] as StoredEvent[], 2],
];

for (const [name, alter, brokenAt] of alterations) {
  test(`${name}: rompe en el seq ${brokenAt}`, async () => {
    assert.deepEqual(await verifyChain(alter(chain(5))), { ok: false, brokenAt });
  });
}

test("se detiene en el primer fallo sin consumir el resto", async () => {
  const events = withPatch(chain(5), 1, { payload: { n: 99 } });
  let consumed = 0;
  async function* counting() {
    for (const event of events) {
      consumed += 1;
      yield event;
    }
  }
  assert.deepEqual(await verifyChain(counting()), broken(2));
  assert.equal(consumed, 2);
});
