import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskCommand } from "./commands.ts";
import { decide } from "./decider.ts";
import { isDomainError } from "./errors.ts";
import type { FlowPolicy } from "./policy.ts";
import type { TaskView } from "./task-view.ts";

const policy: FlowPolicy = { maxProductionLines: 200, maxTotalLines: 500, maxFailedCycles: 3 };
const view: TaskView = {
  exists: true,
  state: "planning",
  title: { hash: "hmac-sha256:t", keyId: "k", dataClass: "task_text" },
  description: null,
  acceptanceCriteria: { hash: "hmac-sha256:c", keyId: "k", dataClass: "task_text" },
  risk: "low",
  planning: { activeSession: "ses_1", planVersion: 0, estimatedLines: null },
};
const usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, durationMs: 1 };
const end = (outcome: string, failureReason?: string | null): TaskCommand =>
  ({
    type: "endSession",
    actor: { kind: "system", component: "adapter:planner" },
    at: "2026-11-05T10:00:00Z",
    session: {
      sessionId: "ses_1",
      outcome,
      usage,
      trajectoryEvents: 2,
      ...(failureReason === undefined ? {} : { failureReason }),
    },
  }) as TaskCommand;

test("el evento session.ended sale en la versión 2 y con el motivo", () => {
  const events = decide(view, end("failed", "worker_died"), policy);
  assert.ok(!isDomainError(events));
  assert.equal(events[0]?.schemaVersion, 2);
  assert.deepEqual(
    (events[0] as unknown as { payload: { failureReason: unknown } }).payload.failureReason,
    "worker_died",
  );
});

test("completed y cancelled no necesitan motivo y salen con null", () => {
  for (const outcome of ["completed", "cancelled"]) {
    const events = decide(view, end(outcome), policy);
    assert.ok(!isDomainError(events));
    assert.equal(
      (events[0] as unknown as { payload: { failureReason: unknown } }).payload.failureReason,
      null,
    );
  }
});

test("failed y timeout sin motivo, o null, se rechazan con un error claro", () => {
  for (const outcome of ["failed", "timeout"]) {
    for (const reason of [undefined, null]) {
      const result = decide(view, end(outcome, reason), policy);
      assert.ok(isDomainError(result));
      assert.equal(result.code, "missing_failure_reason");
      assert.match(result.message, new RegExp(`${outcome} necesita motivo`));
    }
  }
});

test("una sesión completada con motivo se rechaza", () => {
  const result = decide(view, end("completed", "agent_failed"), policy);
  assert.ok(isDomainError(result));
  assert.equal(result.code, "missing_failure_reason");
});
