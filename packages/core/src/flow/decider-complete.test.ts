import assert from "node:assert/strict";
import { test } from "node:test";
import type { Actor } from "../model/ids.ts";
import { TASK_STATES, type TaskState } from "../model/task.ts";
import type { TaskCommand } from "./commands.ts";
import { decide } from "./decider.ts";
import { type DomainError, isDomainError } from "./errors.ts";
import type { FlowPolicy } from "./policy.ts";
import { evolve, type NewTaskEvent, type TaskView } from "./task-view.ts";

const policy: FlowPolicy = { maxProductionLines: 200, maxTotalLines: 500, maxFailedCycles: 3 };
const at = "2026-11-08T10:00:00Z";
const human: Actor = { kind: "human", userId: "usr_1" };
const agent: Actor = { kind: "agent", sessionId: "ses_1", role: "planner" };
const system: Actor = { kind: "system", component: "adapter:planner" };
const blob = { hash: "hmac-sha256:x", keyId: "k1", dataClass: "task_text" } as const;

const view = (state: TaskState): TaskView => ({
  exists: true,
  state,
  title: blob,
  description: null,
  acceptanceCriteria: blob,
  risk: "low",
});
const complete = (actor: Actor, prNumber = 125): TaskCommand => ({
  type: "completeTask",
  actor,
  at,
  prNumber,
});
const error = (state: TaskState, actor: Actor): DomainError => {
  const out = decide(view(state), complete(actor), policy);
  assert.ok(isDomainError(out), `esperaba un error en ${state} con ${actor.kind}`);
  return out;
};

test("un humano completa una tarea en building y se emite task.completed con el PR y su actor", () => {
  const events = decide(view("building"), complete(human, 125), policy);
  assert.deepEqual(events, [
    { schemaVersion: 1, actor: human, at, type: "task.completed", payload: { prNumber: 125 } },
  ]);
});

test("desde cualquier otro estado no final se rechaza con invalid_state", () => {
  const others = TASK_STATES.filter(
    (s) => !["building", "merged", "failed", "rejected"].includes(s),
  );
  assert.ok(others.length >= 4, "draft, planning, plan_review, verifying y review al menos");
  for (const state of others) assert.equal(error(state, human).code, "invalid_state", state);
});

test("un actor agent o system recibe actor_not_allowed y no se emite ningún evento", () => {
  for (const actor of [agent, system]) {
    assert.equal(error("building", actor).code, "actor_not_allowed", actor.kind);
  }
});

test("el actor se comprueba antes que el estado: un agente en draft también recibe actor_not_allowed", () => {
  assert.equal(error("draft", agent).code, "actor_not_allowed");
});

test("una tarea en merged, failed o rejected devuelve task_final", () => {
  for (const state of ["merged", "failed", "rejected"] as const) {
    assert.equal(error(state, human).code, "task_final", state);
  }
});

test("una tarea que no existe devuelve task_not_found", () => {
  const out = decide({ exists: false }, complete(human), policy);
  assert.ok(isDomainError(out));
  assert.equal(out.code, "task_not_found");
});

test("evolve lleva la tarea de building a merged y no toca el resto de la vista", () => {
  const before = view("building");
  const event = {
    schemaVersion: 1,
    actor: human,
    at,
    type: "task.completed",
    payload: { prNumber: 125 },
  } as NewTaskEvent;
  const after = evolve(before, event);
  assert.deepEqual(after, { ...before, state: "merged" });
});

test("completar dos veces no es posible: la segunda ya es task_final", () => {
  const first = decide(view("building"), complete(human), policy);
  assert.ok(Array.isArray(first));
  const merged = evolve(view("building"), first[0] as NewTaskEvent);
  const second = decide(merged, complete(human), policy);
  assert.ok(isDomainError(second));
  assert.equal(second.code, "task_final");
});
