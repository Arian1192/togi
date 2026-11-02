import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventEnvelope } from "../model/events.ts";
import { GENESIS_HASH, hashEvent } from "./hash.ts";

const base: EventEnvelope<string, unknown> = {
  seq: 1,
  stream: "task:1",
  streamVersion: 1,
  type: "task.created",
  schemaVersion: 1,
  actor: { kind: "human", userId: "usr_1" },
  at: "2026-11-03T10:00:00Z",
  payload: {},
};

test("el génesis son 64 ceros", () => {
  assert.equal(GENESIS_HASH, "0".repeat(64));
});

test("vector fijo, calculado aparte con shasum -a 256 sobre génesis + JSON canónico", () => {
  assert.equal(
    hashEvent(GENESIS_HASH, base),
    "33ddeba5baf01cdc273a23a91ef0e322bb88dad334ff5755f4e8a847d8a74aab",
  );
});

test("es determinista y no depende del orden de claves", () => {
  const shuffled = {
    payload: {},
    type: "task.created",
    at: base.at,
    actor: { userId: "usr_1", kind: "human" },
    seq: 1,
    schemaVersion: 1,
    streamVersion: 1,
    stream: "task:1",
  } as EventEnvelope<string, unknown>;
  assert.equal(hashEvent(GENESIS_HASH, shuffled), hashEvent(GENESIS_HASH, base));
});

const fullEnvelope = { ...base, correlationId: "c1" };
const fieldChanges: [string, Partial<EventEnvelope<string, unknown>>][] = [
  ["seq", { seq: 2 }],
  ["stream", { stream: "task:2" }],
  ["streamVersion", { streamVersion: 2 }],
  ["type", { type: "task.submitted" }],
  ["schemaVersion", { schemaVersion: 2 }],
  ["actor", { actor: { kind: "human", userId: "usr_2" } }],
  ["at", { at: "2026-11-03T10:00:01Z" }],
  ["correlationId", { correlationId: "c2" }],
  ["payload", { payload: { x: 1 } }],
];

for (const [field, change] of fieldChanges) {
  test(`cambiar ${field} cambia el hash`, () => {
    assert.notEqual(
      hashEvent(GENESIS_HASH, { ...fullEnvelope, ...change }),
      hashEvent(GENESIS_HASH, fullEnvelope),
    );
  });
}

test("el prevHash entra en el hash", () => {
  assert.notEqual(hashEvent("1".repeat(64), base), hashEvent(GENESIS_HASH, base));
});

test("correlationId solo se representa ausente: null se rechaza y undefined equivale a ausente", () => {
  const withNull = { ...base, correlationId: null } as unknown as EventEnvelope<string, unknown>;
  assert.throws(() => hashEvent(GENESIS_HASH, withNull), TypeError);
  const withUndefined = { ...base, correlationId: undefined } as unknown as EventEnvelope<
    string,
    unknown
  >;
  assert.equal(hashEvent(GENESIS_HASH, withUndefined), hashEvent(GENESIS_HASH, base));
});

test("ignora prevHash y hash si llegan en un StoredEvent", () => {
  const stored = { ...base, prevHash: "x", hash: "y" };
  assert.equal(hashEvent(GENESIS_HASH, stored), hashEvent(GENESIS_HASH, base));
});
