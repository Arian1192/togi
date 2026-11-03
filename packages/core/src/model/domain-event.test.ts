import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoredEvent } from "../ports/event-store.ts";
import { EventParseError, toDomainEvent } from "./domain-event.ts";

const blob = { hash: "hmac-sha256:abc", keyId: "key_1", dataClass: "task_text" };
const created = {
  title: "Añadir filtro",
  description: null,
  acceptanceCriteria: blob,
  risk: "low",
  repo: "Arian1192/promos",
  baseBranch: "dev",
  source: { kind: "cli" },
};

const stored = (type: string, payload: unknown, over: Partial<StoredEvent> = {}): StoredEvent => ({
  seq: 7,
  stream: "task:1",
  streamVersion: 1,
  type,
  schemaVersion: 1,
  actor: { kind: "human", userId: "usr_1" },
  at: "2026-11-03T10:00:00Z",
  payload,
  prevHash: "p",
  hash: "h",
  ...over,
});

const rejection = (event: StoredEvent) =>
  assert.throws(
    () => toDomainEvent(event),
    (e) => e instanceof EventParseError && e.seq === 7 && e.message.includes("seq 7"),
  );

test("convierte los eventos de tarea y de admin válidos", () => {
  const valid = [
    stored("task.created", created),
    stored("task.edited", { title: "Otro título", description: null }),
    stored("task.submitted", {}),
    stored("task.rejected", { reason: { category: "scope", text: blob } }),
    stored(
      "data.erased",
      { keyId: "key_1", taskId: 1, dataClass: "prompt", reason: "RGPD" },
      { stream: "admin" },
    ),
  ];
  for (const event of valid) {
    const domain = toDomainEvent(event);
    assert.equal(domain.type, event.type);
    assert.deepEqual(domain.payload, event.payload);
    assert.equal(domain.seq, 7);
    assert.equal("hash" in domain, false);
  }
});

test("conserva correlationId solo si existe", () => {
  assert.equal("correlationId" in toDomainEvent(stored("task.submitted", {})), false);
  const withId = toDomainEvent(stored("task.submitted", {}, { correlationId: "req-1" }));
  assert.equal(withId.correlationId, "req-1");
});

test("rechaza un tipo desconocido", () => {
  rejection(stored("task.exploded", {}));
});

test("rechaza un campo de más y uno de menos", () => {
  rejection(stored("task.created", { ...created, extra: 1 }));
  const { repo: _repo, ...sinRepo } = created;
  rejection(stored("task.created", sinRepo));
  rejection(stored("task.submitted", { extra: 1 }));
  rejection(stored("task.edited", { title: "x", extra: 1 }));
});

test("rechaza un valor fuera de lista", () => {
  rejection(stored("task.created", { ...created, risk: "extreme" }));
  rejection(stored("task.rejected", { reason: { category: "nope", text: blob } }));
  rejection(stored("task.created", { ...created, description: { ...blob, dataClass: "otra" } }));
});

test("rechaza envoltorio inválido y stream que no corresponde al tipo", () => {
  rejection(stored("task.submitted", {}, { schemaVersion: 2 }));
  rejection(stored("task.submitted", {}, { actor: { kind: "robot" } as never }));
  rejection(stored("task.submitted", {}, { at: "ayer" }));
  rejection(stored("task.submitted", {}, { stream: "admin" }));
  rejection(stored("data.erased", { keyId: "k", taskId: 1, dataClass: "prompt", reason: "r" }));
});
