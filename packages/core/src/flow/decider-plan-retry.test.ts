import assert from "node:assert/strict";
import { test } from "node:test";
import { toDomainEvent } from "../model/domain-event.ts";
import type { Actor } from "../model/ids.ts";
import type { TaskState } from "../model/task.ts";
import type { TaskCommand } from "./commands.ts";
import { decide } from "./decider.ts";
import { isDomainError } from "./errors.ts";
import type { FlowPolicy } from "./policy.ts";
import { evolve, type TaskView } from "./task-view.ts";

const policy: FlowPolicy = { maxProductionLines: 200, maxTotalLines: 500, maxFailedCycles: 3 };
const at = "2026-11-04T10:00:00Z";
const human: Actor = { kind: "human", userId: "usr_1" };
const blob = { hash: "hmac-sha256:x", keyId: "k1", dataClass: "task_text" } as const;

const view = (state: TaskState, activeSession: `ses_${string}` | null = null): TaskView => ({
  exists: true,
  state,
  title: blob,
  description: null,
  acceptanceCriteria: blob,
  risk: "low",
  planning: { activeSession, planVersion: 0, estimatedLines: null },
});
const retry = (actor: Actor = human) => ({ type: "requestPlanRetry", actor, at }) as TaskCommand;

test("en planning, sin sesión activa, produce plan.retry_requested con el humano que lo pidió", () => {
  const events = decide(view("planning"), retry(), policy);
  assert.ok(!isDomainError(events));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    schemaVersion: 1,
    actor: human,
    at,
    type: "plan.retry_requested",
    payload: {},
  });
});

test("el evento no mueve la vista: la tarea sigue en planning", () => {
  const events = decide(view("planning"), retry(), policy);
  assert.ok(!isDomainError(events));
  const before = view("planning");
  assert.deepEqual(evolve(before, events[0] as never), before);
});

test("un actor que no es human da actor_not_allowed", () => {
  for (const actor of [
    { kind: "system", component: "adapter:planner" },
    { kind: "agent", sessionId: "ses_1", role: "planner" },
  ] as const) {
    const r = decide(view("planning"), retry(actor), policy);
    assert.ok(isDomainError(r));
    assert.equal(r.code, "actor_not_allowed");
  }
});

test("fuera de planning da invalid_state", () => {
  for (const state of ["draft", "plan_review", "building"] as const) {
    const r = decide(view(state), retry(), policy);
    assert.ok(isDomainError(r), state);
    assert.equal(r.code, "invalid_state");
  }
});

test("con una sesión activa da session_already_active", () => {
  const r = decide(view("planning", "ses_1"), retry(), policy);
  assert.ok(isDomainError(r));
  assert.equal(r.code, "session_already_active");
});

test("una tarea cerrada da task_final y una inexistente task_not_found", () => {
  const closed = decide(view("rejected"), retry(), policy);
  assert.ok(isDomainError(closed) && closed.code === "task_final");
  const missing = decide({ exists: false }, retry(), policy);
  assert.ok(isDomainError(missing) && missing.code === "task_not_found");
});

test("el esquema lo admite con payload vacío y rechaza campos de más", () => {
  const stored = (payload: unknown) => ({
    seq: 3,
    stream: "task:1",
    streamVersion: 3,
    type: "plan.retry_requested",
    schemaVersion: 1,
    actor: human,
    at,
    payload,
    prevHash: "p",
    hash: "h",
  });
  assert.equal(toDomainEvent(stored({})).type, "plan.retry_requested");
  assert.throws(() => toDomainEvent(stored({ extra: 1 })));
  assert.throws(() => toDomainEvent({ ...stored({}), schemaVersion: 2 }));
});
