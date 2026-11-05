import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoredEvent } from "../ports/event-store.ts";
import { EventParseError, schemaVersionOf, toDomainEvent } from "./domain-event.ts";
import { FAILURE_REASONS } from "./planning.ts";

const usage = { inputTokens: 1, outputTokens: 2, estimatedCostUsd: 0.1, durationMs: 5 };
const v1 = (outcome: string) => ({ sessionId: "ses_1", outcome, usage, trajectoryEvents: 3 });
const v2 = (outcome: string, failureReason: string | null) => ({
  ...v1(outcome),
  failureReason,
});
const stored = (schemaVersion: number, payload: unknown): StoredEvent => ({
  seq: 7,
  stream: "task:1",
  streamVersion: 1,
  type: "session.ended",
  schemaVersion,
  actor: { kind: "system", component: "adapter:planner" },
  at: "2026-11-05T10:00:00Z",
  payload,
  prevHash: "p",
  hash: "h",
});
const rejects = (event: StoredEvent) =>
  assert.throws(
    () => toDomainEvent(event),
    (e) => e instanceof EventParseError && e.seq === 7,
  );

test("session.ended va en la versión 2 y el resto de eventos en la 1", () => {
  assert.equal(schemaVersionOf("session.ended"), 2);
  assert.equal(schemaVersionOf("task.created"), 1);
});

test("un v1 sin motivo se migra al leer con failureReason null, también si falló", () => {
  for (const outcome of ["completed", "failed", "timeout", "cancelled"]) {
    const event = toDomainEvent(stored(1, v1(outcome)));
    assert.deepEqual(event.payload, v2(outcome, null));
    assert.equal(event.schemaVersion, 2);
  }
});

test("un v1 conserva sus reglas estrictas: un campo de más o el motivo ya puesto se rechazan", () => {
  rejects(stored(1, { ...v1("failed"), extra: 1 }));
  rejects(stored(1, v2("failed", "timeout")));
});

test("un v2 con motivo se lee tal cual", () => {
  for (const reason of FAILURE_REASONS) {
    assert.deepEqual(toDomainEvent(stored(2, v2("failed", reason))).payload, v2("failed", reason));
  }
  assert.equal(toDomainEvent(stored(2, v2("completed", null))).schemaVersion, 2);
  assert.equal(toDomainEvent(stored(2, v2("cancelled", null))).schemaVersion, 2);
});

test("un v2 solo admite códigos de la lista cerrada, nunca texto libre", () => {
  rejects(stored(2, v2("failed", "se me cayó el servidor")));
  rejects(stored(2, v2("failed", "/Users/ana/.ssh/id_rsa")));
  rejects(stored(2, v2("failed", "")));
});

test("un v2 exige motivo si falló o agotó el tiempo, y lo prohíbe si completó", () => {
  rejects(stored(2, v2("failed", null)));
  rejects(stored(2, v2("timeout", null)));
  rejects(stored(2, v2("completed", "agent_failed")));
  rejects(stored(2, v1("failed"))); // sin el campo
});

test("una versión posterior a la vigente o la 0 se rechazan", () => {
  rejects(stored(3, v2("failed", "timeout")));
  rejects(stored(0, v1("completed")));
});

test("el resto de eventos sigue rechazando una versión 2", () => {
  const created = { ...stored(2, {}), type: "task.submitted" };
  rejects(created);
});
