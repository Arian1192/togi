import assert from "node:assert/strict";
import { test } from "node:test";
import type { BlobRef } from "../model/blob.ts";
import { toDomainEvent } from "../model/domain-event.ts";
import type { Actor, SessionId } from "../model/ids.ts";
import type { SessionStarted } from "../model/planning.ts";
import type { TaskCommand } from "./commands.ts";
import { decide } from "./decider.ts";
import { type DomainErrorCode, isDomainError } from "./errors.ts";
import type { FlowPolicy } from "./policy.ts";
import { evolve, type NewTaskEvent, type TaskView } from "./task-view.ts";

// La construcción (ADR-011) y la sesión del builder que no entrega (enmienda del ADR-004, 11 de
// noviembre): togi prepara la copia, abre la sesión, la reintenta una vez si se cae por un fallo
// pasajero y entrega lo que haya si terminó o agotó el tiempo. Nada de esto gasta ciclo.

const policy: FlowPolicy = { maxProductionLines: 200, maxTotalLines: 500, maxFailedCycles: 3 };
const at = "2026-11-11T10:00:00Z";
const blob: BlobRef = { hash: "hmac-sha256:x", keyId: "k1", dataClass: "task_text" };
const sha = "a".repeat(40);
const sha2 = "b".repeat(40);
const human: Actor = { kind: "human", userId: "usr_1" };
const system: Actor = { kind: "system", component: "adapter:builder" };
const builder: Actor = { kind: "agent", sessionId: "ses_b1", role: "builder" };

const building: TaskView = {
  exists: true,
  state: "building",
  title: blob,
  description: null,
  acceptanceCriteria: blob,
  risk: "low",
  planning: { activeSession: null, planVersion: 1, estimatedLines: { production: 10, tests: 20 } },
};
const workspace = {
  workspaceId: "wsp_1",
  kind: "clone",
  ref: "/Users/x/.togi/workspaces/wsp_1",
  branch: "togi/7-x",
  baseSha: sha,
} as const;
const session = (sessionId: SessionId, cycle = 1, workspaceId = "wsp_1"): SessionStarted => ({
  sessionId,
  role: "builder",
  cycle,
  runtime: { id: "claude-agent-sdk", version: "1" },
  model: "claude-sonnet-5-5",
  specialist: { id: "generic-builder", version: 1, hash: "sha256:abc" },
  workspaceId: workspaceId as `wsp_${string}`,
  prompt: blob,
  policy: blob,
});
const usage = { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0, durationMs: 1 };

const cmd = (c: Record<string, unknown>, actor: Actor = system) =>
  ({ actor, at, ...c }) as TaskCommand;
const createWorkspace = (w: Record<string, unknown> = workspace, actor?: Actor) =>
  cmd({ type: "createWorkspace", workspace: w }, actor);
const start = (id: SessionId, cycle = 1, workspaceId = "wsp_1", actor?: Actor) =>
  cmd({ type: "startSession", session: session(id, cycle, workspaceId) }, actor);
const end = (id: SessionId, outcome: string, failureReason: string | null = null) =>
  cmd({
    type: "endSession",
    session: { sessionId: id, outcome, usage, trajectoryEvents: 3, failureReason },
  });
const submit = (cycle = 1, headSha = sha2, actor?: Actor) =>
  cmd({ type: "submitBuild", cycle, headSha }, actor);

/** Cada evento emitido se guarda y se vuelve a leer como lo haría el daemon: el esquema lo admite. */
function readBack(event: NewTaskEvent) {
  const stored = { ...event, seq: 1, stream: "task:7", streamVersion: 1, prevHash: "p", hash: "h" };
  assert.deepEqual(toDomainEvent(stored).payload, event.payload);
}
function run(view: TaskView, ...cmds: TaskCommand[]): TaskView {
  return cmds.reduce((v, c) => {
    const r = decide(v, c, policy);
    assert.ok(!isDomainError(r), isDomainError(r) ? `${c.type}: ${r.code}` : "");
    for (const e of r) readBack(e);
    return r.reduce(evolve, v);
  }, view);
}
function refuse(view: TaskView, c: TaskCommand, code: DomainErrorCode) {
  const r = decide(view, c, policy);
  assert.ok(isDomainError(r), `${c.type} debía fallar`);
  assert.equal(r.code, code);
}
const ready = run(building, createWorkspace());

test("togi prepara una sola copia de trabajo por tarea, en building y con un commit válido", () => {
  refuse(building, createWorkspace(workspace, human), "actor_not_allowed");
  refuse(building, createWorkspace(workspace, builder), "actor_not_allowed");
  refuse({ ...building, state: "plan_review" }, createWorkspace(), "invalid_state");
  refuse(building, createWorkspace({ ...workspace, baseSha: "main" }), "invalid_payload");
  assert.ok(ready.exists);
  assert.equal(ready.building?.workspaceId, "wsp_1");
  refuse(ready, createWorkspace(), "workspace_already_exists");
});

test("la sesión del builder va en su copia y en el ciclo en curso, y no toca la planificación", () => {
  refuse(building, start("ses_b1"), "workspace_mismatch");
  refuse(ready, start("ses_b1", 1, "wsp_2"), "workspace_mismatch");
  refuse(ready, start("ses_b1", 2), "stale_cycle");
  refuse(ready, start("ses_b1", 1, "wsp_1", human), "actor_not_allowed");
  const open = run(ready, start("ses_b1"));
  assert.ok(open.exists && ready.exists);
  assert.equal(open.building?.activeSession, "ses_b1");
  assert.deepEqual(open.planning, ready.planning);
  refuse(open, start("ses_b2"), "session_already_active");
  const closed = run(open, end("ses_b1", "completed"));
  assert.ok(closed.exists);
  assert.equal(closed.building?.activeSession, null);
  assert.deepEqual(closed.planning, ready.planning);
});

test("en building solo se abre una sesión builder; en planning sigue sin admitirse", () => {
  const planner = { ...session("ses_p"), role: "planner", cycle: null, workspaceId: null };
  refuse(ready, cmd({ type: "startSession", session: planner }), "invalid_state");
  refuse({ ...building, state: "planning" }, start("ses_b1"), "invalid_session_role");
});

test("una sesión que termina o agota el tiempo se entrega: building → verifying, sin gastar ciclo", () => {
  for (const [outcome, reason] of [
    ["completed", null],
    ["timeout", "timeout"],
    ["failed", "timeout"], // así lo escribe hoy el daemon
  ] as const) {
    const ended = run(ready, start("ses_b1"), end("ses_b1", outcome, reason));
    const v = run(ended, submit());
    assert.ok(v.exists);
    assert.equal(v.state, "verifying");
    assert.equal(v.building?.cycle, 1);
    assert.equal(v.building?.headSha, sha2);
  }
});

test("la entrega exige una sesión terminada de este ciclo, su ciclo y un commit de git", () => {
  refuse(ready, submit(), "invalid_state");
  const open = run(ready, start("ses_b1"));
  refuse(open, submit(), "session_already_active");
  const ended = run(open, end("ses_b1", "completed"));
  refuse(ended, submit(2), "stale_cycle");
  refuse(ended, submit(1, "HEAD"), "invalid_payload");
  refuse(ended, submit(1, sha2, builder), "actor_not_allowed");
  refuse(ended, submit(1, sha2, human), "actor_not_allowed");
  const cancelled = run(ready, start("ses_b1"), end("ses_b1", "cancelled"));
  refuse(cancelled, submit(), "invalid_state");
});

test("una caída pasajera se reintenta una vez en el mismo ciclo; si vuelve a caer, se pausa", () => {
  const crashed = run(ready, start("ses_b1"), end("ses_b1", "failed", "worker_died"));
  refuse(crashed, submit(), "invalid_state");
  const retried = run(crashed, start("ses_b2"));
  assert.ok(retried.exists);
  assert.equal(retried.building?.cycle, 1);
  const again = run(retried, end("ses_b2", "failed", "worker_died"));
  refuse(again, start("ses_b3"), "actor_not_allowed");
  refuse(again, submit(), "invalid_state");
  // El reintento entrega como cualquier otra sesión.
  const delivered = run(retried, end("ses_b2", "completed"), submit());
  assert.ok(delivered.exists && delivered.state === "verifying");
});

test("una caída que no es pasajera, o una sesión cancelada, pausa sin reintento", () => {
  for (const [outcome, reason] of [
    ["failed", "sandbox_unavailable"],
    ["failed", "agent_failed"],
    ["cancelled", null],
  ] as const) {
    const v = run(ready, start("ses_b1"), end("ses_b1", outcome, reason));
    refuse(v, start("ses_b2"), "actor_not_allowed");
  }
});

test("un ciclo fallido empieza el siguiente con las sesiones a cero", () => {
  const verifying = run(
    ready,
    start("ses_b1"),
    end("ses_b1", "failed", "worker_died"),
    start("ses_b2"),
    end("ses_b2", "completed"),
    submit(),
  );
  // Solo un gate que da `fail` gasta ciclo (ADR-004 §1).
  const failedGate = {
    gateRunId: "gr_1",
    cycle: 1,
    headSha: sha2,
    gate: "test",
    status: "fail",
    summary: "s",
    evidence: null,
    durationMs: 1,
  };
  const next = [
    { type: "gate.completed", payload: failedGate },
    { type: "verification.completed", payload: { cycle: 1, headSha: sha2, passed: false } },
  ].map((e) => ({ ...e, schemaVersion: 1, actor: system, at }) as NewTaskEvent);
  const cycle2 = next.reduce(evolve, verifying);
  assert.ok(cycle2.exists);
  assert.deepEqual(cycle2.building, { cycle: 2, workspaceId: "wsp_1", headSha: null, gates: {} });
  const v = run(cycle2, start("ses_b3", 2), end("ses_b3", "completed"), submit(2));
  assert.ok(v.exists && v.state === "verifying");
});
