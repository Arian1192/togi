import assert from "node:assert/strict";
import { test } from "node:test";
import type { Actor } from "../model/ids.ts";
import {
  FAILURE_REASONS,
  type FailureReason,
  isTransientFailure,
  MAX_AUTO_RETRIES,
  TRANSIENT_FAILURE_REASONS,
} from "../model/planning.ts";
import { REASON_CATEGORIES, type TaskState } from "../model/task.ts";
import type { TaskCommand } from "./commands.ts";
import { decide } from "./decider.ts";
import { isDomainError } from "./errors.ts";
import type { FlowPolicy } from "./policy.ts";
import { evolve, type NewTaskEvent, type PlanningView, type TaskView } from "./task-view.ts";

const policy: FlowPolicy = { maxProductionLines: 200, maxTotalLines: 500, maxFailedCycles: 3 };
const at = "2026-11-06T10:00:00Z";
const human: Actor = { kind: "human", userId: "usr_1" };
const system: Actor = { kind: "system", component: "adapter:planner" };
const blob = { hash: "hmac-sha256:x", keyId: "k1", dataClass: "task_text" } as const;

const view = (state: TaskState, planning: Partial<PlanningView> = {}): TaskView => ({
  exists: true,
  state,
  title: blob,
  description: null,
  acceptanceCriteria: blob,
  risk: "low",
  planning: { activeSession: null, planVersion: 0, estimatedLines: null, ...planning },
});
const retry = (actor: Actor) => ({ type: "requestPlanRetry", actor, at }) as TaskCommand;
const retried = (actor: Actor) =>
  ({ schemaVersion: 1, actor, at, type: "plan.retry_requested", payload: {} }) as NewTaskEvent;
const ended = (failureReason: FailureReason | null) =>
  ({
    schemaVersion: 2,
    actor: system,
    at,
    type: "session.ended",
    payload: {
      sessionId: "ses_1",
      outcome: failureReason === null ? "completed" : "failed",
      usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, durationMs: 0 },
      trajectoryEvents: 0,
      failureReason,
    },
  }) as NewTaskEvent;
const proposed = {
  schemaVersion: 1,
  actor: system,
  at,
  type: "plan.proposed",
  payload: { planVersion: 1, estimatedLines: { production: 10, tests: 20 } },
} as unknown as NewTaskEvent;
const planningOf = (v: TaskView) => (v.exists ? v.planning : undefined);

test("la lista de fallos pasajeros es cerrada y fijada en positivo", () => {
  assert.deepEqual([...TRANSIENT_FAILURE_REASONS], ["worker_died", "trajectory_write_failed"]);
  assert.equal(MAX_AUTO_RETRIES, 1);
  for (const code of FAILURE_REASONS) {
    assert.equal(
      isTransientFailure(code),
      TRANSIENT_FAILURE_REASONS.some((r) => r === code),
      code,
    );
  }
  assert.equal(isTransientFailure(null), false);
  assert.equal(isTransientFailure(undefined), false);
});

test("system con worker_died o trajectory_write_failed y sin reintentos: plan.retry_requested", () => {
  for (const lastFailure of ["worker_died", "trajectory_write_failed"] as const) {
    for (const autoRetries of [undefined, 0]) {
      const planning = autoRetries === undefined ? { lastFailure } : { lastFailure, autoRetries };
      const events = decide(view("planning", planning), retry(system), policy);
      assert.ok(!isDomainError(events), `${lastFailure} ${autoRetries}`);
      assert.deepEqual(events, [
        { schemaVersion: 1, actor: system, at, type: "plan.retry_requested", payload: {} },
      ]);
    }
  }
});

test("system con cualquier otro motivo, o sin fallo previo, da actor_not_allowed", () => {
  const others = FAILURE_REASONS.filter((r) => !isTransientFailure(r));
  assert.ok(others.includes("timeout") && others.includes("agent_failed"));
  for (const lastFailure of [...others, null, undefined]) {
    const planning = lastFailure === undefined ? {} : { lastFailure };
    const r = decide(view("planning", planning), retry(system), policy);
    assert.ok(isDomainError(r), String(lastFailure));
    assert.equal(r.code, "actor_not_allowed", String(lastFailure));
  }
});

test("system con un motivo pasajero pero ya reintentado una vez es rechazado", () => {
  const planning = { lastFailure: "worker_died", autoRetries: 1 } as const;
  const r = decide(view("planning", planning), retry(system), policy);
  assert.ok(isDomainError(r));
  assert.equal(r.code, "actor_not_allowed");
});

test("system conserva las comprobaciones de estado y de sesión activa", () => {
  const failed = { lastFailure: "worker_died" } as const;
  const wrongState = decide(view("plan_review", failed), retry(system), policy);
  assert.ok(isDomainError(wrongState) && wrongState.code === "invalid_state");
  const active = decide(
    view("planning", { ...failed, activeSession: "ses_1" }),
    retry(system),
    policy,
  );
  assert.ok(isDomainError(active) && active.code === "session_already_active");
});

test("un humano reintenta sin límite aunque haya muchos reintentos automáticos", () => {
  const planning = { lastFailure: "timeout", autoRetries: 7 } as const;
  const events = decide(view("planning", planning), retry(human), policy);
  assert.ok(!isDomainError(events));
  assert.equal(events[0]?.actor, human);
});

test("un agente sigue sin poder reintentar", () => {
  const agent: Actor = { kind: "agent", sessionId: "ses_1", role: "planner" };
  const r = decide(view("planning", { lastFailure: "worker_died" }), retry(agent), policy);
  assert.ok(isDomainError(r) && r.code === "actor_not_allowed");
});

test("evolve guarda el motivo de la sesión que acaba, y lo borra si completa", () => {
  const failed = evolve(view("planning"), ended("worker_died"));
  assert.equal(planningOf(failed)?.lastFailure, "worker_died");
  assert.equal(planningOf(failed)?.activeSession, null);
  assert.equal(planningOf(evolve(failed, ended(null)))?.lastFailure, null);
});

test("evolve cuenta el reintento del sistema y el humano reinicia la cuenta", () => {
  const first = evolve(view("planning"), retried(system));
  assert.equal(planningOf(first)?.autoRetries, 1);
  assert.equal(planningOf(evolve(first, retried(system)))?.autoRetries, 2);
  assert.equal(planningOf(evolve(first, retried(human)))?.autoRetries, 0);
});

test("un reintento humano sin nada que reiniciar no mueve la vista", () => {
  const before = view("planning");
  assert.equal(evolve(before, retried(human)), before);
});

test("plan.proposed reinicia el fallo y los reintentos automáticos", () => {
  const before = view("planning", { lastFailure: "worker_died", autoRetries: 1 });
  const planning = planningOf(evolve(before, proposed));
  assert.equal(planning?.lastFailure, undefined);
  assert.equal(planning?.autoRetries, undefined);
  assert.equal(planning?.planVersion, 1);
});

test("aprobar y rechazar planes siguen rechazando al actor system", () => {
  const review = view("plan_review", {
    planVersion: 1,
    estimatedLines: { production: 10, tests: 20 },
  });
  const reason = { category: REASON_CATEGORIES[0], text: "x" };
  const commands = [
    { type: "approvePlan", actor: system, at, planVersion: 1 },
    { type: "rejectPlan", actor: system, at, planVersion: 1, reason },
    { type: "requestPlanChanges", actor: system, at, planVersion: 1, reason },
  ] as TaskCommand[];
  for (const cmd of commands) {
    const r = decide(review, cmd, policy);
    assert.ok(isDomainError(r) && r.code === "actor_not_allowed", cmd.type);
  }
});
