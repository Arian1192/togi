import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskEvent } from "../model/events.ts";
import type { TaskState } from "../model/task.ts";
import { type StateHint, stateAfter } from "./state-after.ts";
import { evolve, type NewTaskEvent, NO_TASK, type TaskView } from "./task-view.ts";

// El mapa de estados que importa el escritorio (ADR-010 §1) no puede separarse de `evolve`: cada tipo
// de evento, con cada pista posible, lleva al mismo estado desde cualquier estado anterior.

const sha = "a".repeat(40);
const blob = { hash: "hmac-sha256:x", keyId: "key_1", dataClass: "task_text" } as const;
const reason = { category: "misunderstanding", text: blob };
const human = { kind: "human", userId: "usr_1" } as const;
const ev = (type: string, payload: unknown): NewTaskEvent =>
  ({ schemaVersion: 1, actor: human, at: "2026-11-11T10:00:00Z", type, payload }) as NewTaskEvent;
const at = (state: TaskState): TaskView => ({
  exists: true,
  state,
  title: blob,
  description: null,
  acceptanceCriteria: null,
  risk: "low",
  building: { cycle: 1, workspaceId: "wsp_1", headSha: sha, gates: {}, activeSession: "ses_b" },
});

const started = {
  sessionId: "ses_1",
  role: "planner",
  specialist: { id: "generic-planner", version: 1 },
  runtime: { id: "claude-code", version: "1.0.0" },
  model: "m",
};
const usage = { durationMs: 1, inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 };
const decision = (verdict: string) => ({ planVersion: 1, verdict, reason });

// Un Record sobre todos los tipos: un evento nuevo no compila hasta que esté aquí.
const CASES: Record<TaskEvent["type"], { payload: unknown; hint?: StateHint }[]> = {
  "task.created": [
    { payload: { title: blob, description: null, acceptanceCriteria: null, risk: "low" } },
  ],
  "task.edited": [{ payload: { title: blob } }],
  "task.submitted": [{ payload: {} }],
  "session.started": [{ payload: started }, { payload: { ...started, role: "builder" } }],
  "session.ended": [
    { payload: { sessionId: "ses_1", outcome: "completed", usage } },
    { payload: { sessionId: "ses_b", outcome: "failed", failureReason: "timeout", usage } },
  ],
  "plan.retry_requested": [{ payload: {} }],
  "plan.proposed": [
    { payload: { planVersion: 2, estimatedLines: { production: 1, tests: 1 }, plan: blob } },
  ],
  "decision.recorded": (["approve", "request_changes", "reject"] as const).map((verdict) => ({
    payload: decision(verdict),
    hint: { verdict },
  })),
  "task.rejected": [{ payload: { reason } }],
  "task.completed": [{ payload: { prNumber: 1 } }],
  "workspace.created": [
    { payload: { workspaceId: "wsp_2", kind: "clone", ref: "/r", branch: "b", baseSha: sha } },
  ],
  "build.submitted": [{ payload: { cycle: 1, headSha: sha } }],
  "gate.completed": [
    { payload: { gateRunId: "gr_1", cycle: 1, headSha: sha, gate: "tests", status: "pass" } },
  ],
  "verification.completed": [true, false].map((passed) => ({
    payload: { cycle: 1, headSha: sha, passed },
    hint: { passed },
  })),
  "task.failed": [{ payload: { cycle: 1, failedGates: [] } }],
  "failure.classified": [{ payload: { reason } }],
  "workspace.released": [{ payload: { workspaceId: "wsp_1" } }],
};

/** El estado al que lleva el evento según `evolve`: `null` si cada estado anterior se queda igual. */
function evolved(event: NewTaskEvent): string | null {
  const after = [at("draft"), at("review")].map((v) => evolve(v, event));
  const states = after.map((v) => (v.exists ? v.state : null));
  if (states[0] === "draft" && states[1] === "review") return null;
  assert.equal(states[0], states[1], `${event.type} depende del estado anterior`);
  return states[0] ?? null;
}

test("stateAfter da, para cada tipo de evento y pista, el mismo estado que evolve", () => {
  for (const [type, cases] of Object.entries(CASES)) {
    for (const { payload, hint } of cases) {
      const expected = evolved(ev(type, payload));
      assert.equal(stateAfter(type as TaskEvent["type"], hint ?? {}), expected, type);
    }
  }
});

test("sin la pista que lo decide, la decisión y la verificación no dan estado", () => {
  assert.equal(stateAfter("decision.recorded", {}), null);
  assert.equal(stateAfter("verification.completed", {}), null);
});

test("task.created lleva a draft aunque no hubiera tarea", () => {
  const v = evolve(NO_TASK, ev("task.created", CASES["task.created"][0]?.payload));
  assert.ok(v.exists);
  assert.equal(v.state, stateAfter("task.created", {}));
});
