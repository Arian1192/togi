import assert from "node:assert/strict";
import { test } from "node:test";
import type { BlobRef } from "../model/blob.ts";
import type { Actor, SessionId } from "../model/ids.ts";
import type { SessionStarted } from "../model/planning.ts";
import type { ReasonCategory, TaskState } from "../model/task.ts";
import type { TaskCommand } from "./commands.ts";
import { decide } from "./decider.ts";
import { type DomainErrorCode, isDomainError } from "./errors.ts";
import type { FlowPolicy } from "./policy.ts";
import { evolve, type NewTaskEvent, type PlanningView, type TaskView } from "./task-view.ts";

const policy: FlowPolicy = { maxProductionLines: 200, maxTotalLines: 500, maxFailedCycles: 3 };
const at = "2026-11-04T10:00:00Z";
const blob = (n: string): BlobRef => ({
  hash: `hmac-sha256:${n}`,
  keyId: "k1",
  dataClass: "task_text",
});
const SES: SessionId = "ses_1";
const human: Actor = { kind: "human", userId: "usr_1" };
const system: Actor = { kind: "system", component: "adapter:planner" };
const agent = (sessionId: SessionId = SES): Actor => ({
  kind: "agent",
  sessionId,
  role: "planner",
});

const session = (sessionId: SessionId = SES): SessionStarted => ({
  sessionId,
  role: "planner",
  cycle: null,
  runtime: { id: "fake", version: "1" },
  model: "m",
  specialist: { id: "generic-planner", version: 1, hash: "sha256:abc" },
  workspaceId: null,
  prompt: blob("p"),
  policy: blob("pol"),
});
const usage = { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0, durationMs: 1 };
const lines = (production: number, tests: number) => ({ production, tests });
const plan = (estimatedLines = lines(10, 20)) => ({
  files: [{ path: "src/a.ts", change: "modify" as const }],
  newTests: ["src/a.test.ts"],
  approach: blob("ap"),
  estimatedLines,
  baseSha: "abc123",
});

const view = (state: TaskState, planning?: Partial<PlanningView>): TaskView => ({
  exists: true,
  state,
  title: blob("t"),
  description: null,
  acceptanceCriteria: blob("ac"),
  risk: "low",
  planning: { activeSession: null, planVersion: 0, estimatedLines: null, ...planning },
});
const inReview = (est = lines(10, 20), v = 1) =>
  view("plan_review", { planVersion: v, estimatedLines: est });

const cmd = (actor: Actor, c: Record<string, unknown>) => ({ actor, at, ...c }) as TaskCommand;
const startSession = (actor: Actor = system) =>
  cmd(actor, { type: "startSession", session: session() });
const endSession = (outcome = "completed", id: SessionId = SES, actor: Actor = system) =>
  cmd(actor, {
    type: "endSession",
    session: {
      sessionId: id,
      outcome,
      usage,
      trajectoryEvents: 0,
      ...(outcome === "failed" || outcome === "timeout"
        ? { failureReason: outcome === "timeout" ? "timeout" : "agent_failed" }
        : {}),
    },
  });
const propose = (actor = agent(), est = lines(10, 20)) =>
  cmd(actor, { type: "proposePlan", plan: plan(est) });
const reason = (category: ReasonCategory = "scope", text: BlobRef | null = blob("why")) => ({
  category,
  text,
});
const approve = (planVersion = 1, actor: Actor = human) =>
  cmd(actor, { type: "approvePlan", planVersion });
const changes = (planVersion = 1, r = reason(), actor: Actor = human) =>
  cmd(actor, { type: "requestPlanChanges", planVersion, reason: r });
const rejectPlan = (planVersion = 1, r = reason(), actor: Actor = human) =>
  cmd(actor, { type: "rejectPlan", planVersion, reason: r });

function ok(v: TaskView, c: TaskCommand): NewTaskEvent[] {
  const r = decide(v, c, policy);
  assert.ok(!isDomainError(r), isDomainError(r) ? r.code : "");
  return r;
}
function fail(v: TaskView, c: TaskCommand, code: DomainErrorCode) {
  const r = decide(v, c, policy);
  assert.ok(isDomainError(r), `${c.type} debía fallar`);
  assert.equal(r.code, code);
}
const stateOf = (v: TaskView, events: NewTaskEvent[]) => {
  const next = events.reduce(evolve, v);
  assert.ok(next.exists);
  return next;
};

test("startSession y endSession exigen actor system", () => {
  fail(view("planning"), startSession(human), "actor_not_allowed");
  fail(
    view("planning", { activeSession: SES }),
    endSession("completed", SES, human),
    "actor_not_allowed",
  );
});

test("solo hay una sesión activa por tarea", () => {
  const v = stateOf(view("planning"), ok(view("planning"), startSession()));
  assert.equal(v.planning?.activeSession, SES);
  fail(v, startSession(), "session_already_active");
});

test("startSession solo en planning", () => {
  fail(view("plan_review"), startSession(), "invalid_state");
  fail(view("building"), startSession(), "invalid_state");
});

test("endSession solo cierra la sesión activa", () => {
  fail(view("planning"), endSession(), "no_active_session");
  fail(
    view("planning", { activeSession: SES }),
    endSession("completed", "ses_2"),
    "not_session_actor",
  );
});

test("una sesión que termina en failed o timeout deja la tarea en planning", () => {
  for (const outcome of ["failed", "timeout"]) {
    const v = view("planning", { activeSession: SES });
    const next = stateOf(v, ok(v, endSession(outcome)));
    assert.equal(next.state, "planning");
    assert.equal(next.planning?.activeSession, null);
  }
});

test("proposePlan lleva a plan_review con planVersion + 1", () => {
  const v1 = stateOf(
    view("planning", { activeSession: SES }),
    ok(view("planning", { activeSession: SES }), propose()),
  );
  assert.equal(v1.state, "plan_review");
  assert.equal(v1.planning?.planVersion, 1);
  const again = view("planning", { activeSession: SES, planVersion: 1 });
  const [event] = ok(again, propose());
  assert.ok(event && event.type === "plan.proposed");
  assert.equal(event.payload.planVersion, 2);
  assert.equal(event.payload.sessionId, SES);
});

test("proposePlan exige actor agent de la sesión activa y estado planning", () => {
  const v = view("planning", { activeSession: SES });
  fail(v, propose(human), "actor_not_allowed");
  fail(v, propose(system), "actor_not_allowed");
  fail(v, propose(agent("ses_2")), "not_session_actor");
  fail(view("planning"), propose(), "no_active_session");
  fail(view("plan_review", { activeSession: SES }), propose(), "invalid_state");
});

test("las decisiones llevan a building, planning o rejected", () => {
  const v = inReview();
  assert.equal(stateOf(v, ok(v, approve())).state, "building");
  assert.equal(stateOf(v, ok(v, changes())).state, "planning");
  assert.equal(stateOf(v, ok(v, rejectPlan())).state, "rejected");
  const [event] = ok(v, changes());
  assert.ok(event && event.type === "decision.recorded");
  assert.equal(event.payload.gate, "plan");
  assert.equal(event.payload.mode, "binding");
  assert.equal(event.payload.subject.planVersion, 1);
});

test("las decisiones solo en plan_review y sobre la última versión", () => {
  for (const c of [approve(), changes(), rejectPlan()]) {
    fail(view("planning"), c, "invalid_state");
    fail(view("building"), c, "invalid_state");
  }
  const v = inReview(lines(10, 20), 2);
  for (const c of [approve(1), changes(1), rejectPlan(1)]) fail(v, c, "stale_plan_version");
});

test("requestPlanChanges y rejectPlan exigen motivo", () => {
  for (const make of [changes, rejectPlan]) {
    fail(inReview(), make(1, reason("scope", null)), "invalid_reason");
    fail(inReview(), make(1, reason("nope" as ReasonCategory)), "invalid_reason");
  }
});

test("approvePlan se rechaza si supera el límite de producción", () => {
  fail(inReview(lines(201, 0)), approve(), "plan_exceeds_limits");
});

test("approvePlan se rechaza si supera el límite total", () => {
  fail(inReview(lines(100, 401)), approve(), "plan_exceeds_limits");
});

test("approvePlan acepta un plan justo en los límites", () => {
  assert.equal(
    stateOf(inReview(lines(200, 300)), ok(inReview(lines(200, 300)), approve())).state,
    "building",
  );
});

test("un plan que supera los límites aún se puede rechazar o pedir cambios", () => {
  const v = inReview(lines(900, 900));
  ok(v, changes());
  ok(v, rejectPlan());
});

test("un agente nunca aprueba, pide cambios ni rechaza", () => {
  for (const actor of [agent(), system]) {
    fail(inReview(), approve(1, actor), "actor_not_allowed");
    fail(inReview(), changes(1, reason(), actor), "actor_not_allowed");
    fail(inReview(), rejectPlan(1, reason(), actor), "actor_not_allowed");
  }
});

test("ciclo completo: sesión, plan, cambios, plan v2 y aprobación", () => {
  const steps: TaskCommand[] = [
    startSession(),
    propose(),
    endSession(),
    changes(1),
    startSession(),
    propose(agent(), lines(50, 100)),
    endSession(),
    approve(2),
  ];
  let v: TaskView = view("planning");
  const seen: string[] = [];
  for (const step of steps) {
    const events = ok(v, step);
    seen.push(...events.map((e) => e.type));
    v = stateOf(v, events);
  }
  assert.deepEqual(seen, [
    "session.started",
    "plan.proposed",
    "session.ended",
    "decision.recorded",
    "session.started",
    "plan.proposed",
    "session.ended",
    "decision.recorded",
  ]);
  assert.ok(v.exists && v.state === "building" && v.planning?.planVersion === 2);
});

test("startSession en planning solo admite el rol planner", () => {
  for (const role of ["builder", "reviewer"] as const) {
    const c = cmd(system, { type: "startSession", session: { ...session(), role } });
    fail(view("planning"), c, "invalid_session_role");
  }
});
