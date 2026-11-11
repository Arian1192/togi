import assert from "node:assert/strict";
import { test } from "node:test";
import type { BlobRef } from "../model/blob.ts";
import { CONTRACT_GATES, type GateId, type GateStatus } from "../model/building.ts";
import { toDomainEvent } from "../model/domain-event.ts";
import type { Actor } from "../model/ids.ts";
import type { TaskCommand } from "./commands.ts";
import { decide } from "./decider.ts";
import { type DomainErrorCode, isDomainError } from "./errors.ts";
import type { FlowPolicy } from "./policy.ts";
import { evolve, type NewTaskEvent, type TaskView } from "./task-view.ts";

// La verificación (ADR-004 §1, ADR-011 §9): togi registra un gate por ciclo y cierra el ciclo. Solo
// un `fail` gasta ciclo; un `error` no cuenta y los gates se repiten. Al tercer fallo, `task.failed`;
// el humano lo clasifica y togi libera la copia en cualquier estado final.

const policy: FlowPolicy = { maxProductionLines: 200, maxTotalLines: 500, maxFailedCycles: 3 };
const at = "2026-11-11T10:00:00Z";
const blob: BlobRef = { hash: "hmac-sha256:x", keyId: "k1", dataClass: "task_text" };
const sha = "b".repeat(40);
const human: Actor = { kind: "human", userId: "usr_1" };
const system: Actor = { kind: "system", component: "gates" };
const builder: Actor = { kind: "agent", sessionId: "ses_b1", role: "builder" };
const CHECKS: GateId[] = ["typecheck", "test"]; // el perfil de promos no tiene lint

type Task = Extract<TaskView, { exists: true }>;
const verifying = (cycle = 1): Task => ({
  exists: true,
  state: "verifying",
  title: blob,
  description: null,
  acceptanceCriteria: blob,
  risk: "low",
  building: { cycle, workspaceId: "wsp_1", headSha: sha, gates: {} },
});

const cmd = (c: Record<string, unknown>, actor: Actor = system) =>
  ({ actor, at, ...c }) as TaskCommand;
let runs = 0;
const gate = (name: GateId, status: GateStatus = "pass", cycle = 1, extra = {}, actor?: Actor) =>
  cmd(
    {
      type: "recordGate",
      run: {
        gateRunId: `gr_${++runs}`,
        cycle,
        headSha: sha,
        gate: name,
        status,
        summary: "s",
        evidence: null,
        durationMs: 1,
        ...extra,
      },
    },
    actor,
  );
const complete = (cycle = 1, checks = CHECKS, actor?: Actor) =>
  cmd({ type: "completeVerification", cycle, checks }, actor);
const classify = (category = "scope", actor: Actor = human) =>
  cmd({ type: "classifyFailure", reason: { category, text: blob } }, actor);
const release = (workspaceId = "wsp_1", actor?: Actor) =>
  cmd({ type: "releaseWorkspace", workspaceId }, actor);

/** Cada evento emitido se guarda y se vuelve a leer como lo haría el daemon: el esquema lo admite. */
function readBack(event: NewTaskEvent) {
  const stored = { ...event, seq: 1, stream: "task:7", streamVersion: 1, prevHash: "p", hash: "h" };
  assert.deepEqual(toDomainEvent(stored).payload, event.payload);
}
function emit(view: TaskView, c: TaskCommand): NewTaskEvent[] {
  const r = decide(view, c, policy);
  assert.ok(!isDomainError(r), isDomainError(r) ? `${c.type}: ${r.code}` : "");
  for (const e of r) readBack(e);
  return r;
}
function run(view: TaskView, ...cmds: TaskCommand[]): TaskView {
  return cmds.reduce((v, c) => emit(v, c).reduce(evolve, v), view);
}
function refuse(view: TaskView, c: TaskCommand, code: DomainErrorCode) {
  const r = decide(view, c, policy);
  assert.ok(isDomainError(r), `${c.type} debía fallar`);
  assert.equal(r.code, code);
}
/** Todos los gates exigidos, en verde salvo los indicados. */
const allGates = (cycle = 1, statuses: Partial<Record<GateId, GateStatus>> = {}) =>
  [...CONTRACT_GATES, ...CHECKS].map((g) => gate(g, statuses[g] ?? "pass", cycle));

test("togi registra un gate del ciclo en curso, del commit entregado y una sola vez", () => {
  refuse(verifying(), gate("lint", "pass", 1, {}, human), "actor_not_allowed");
  refuse(verifying(), gate("lint", "pass", 1, {}, builder), "actor_not_allowed");
  refuse({ ...verifying(), state: "building" }, gate("lint"), "invalid_state");
  refuse(verifying(), gate("lint", "pass", 2), "stale_cycle");
  refuse(verifying(), gate("lint", "pass", 1, { headSha: "c".repeat(40) }), "head_mismatch");
  refuse(verifying(), gate("lint", "pass", 1, { summary: "a\nb" }), "invalid_payload");
  const v = run(verifying(), gate("lint", "fail"));
  assert.ok(v.exists);
  assert.equal(v.building?.gates.lint?.status, "fail");
  refuse(v, gate("lint", "pass"), "gate_already_recorded");
});

test("un gate que dio error se puede volver a registrar en el mismo ciclo", () => {
  const v = run(verifying(), gate("test", "error"), gate("test", "pass"));
  assert.ok(v.exists);
  assert.equal(v.building?.gates.test?.status, "pass");
});

test("cerrar la verificación exige los gates del contrato y los checks del perfil", () => {
  const partial = run(verifying(), ...allGates().slice(0, -1));
  refuse(partial, complete(), "missing_gates");
  const all = run(partial, gate("test"));
  refuse(all, complete(1, [...CHECKS, "lint"]), "missing_gates");
  refuse(all, complete(2), "stale_cycle");
  refuse(all, complete(1, CHECKS, human), "actor_not_allowed");
  refuse({ ...all, state: "review" } as TaskView, complete(), "invalid_state");
});

test("todo en verde: verification.completed aprobada y la tarea pasa a review", () => {
  const all = run(verifying(), ...allGates());
  assert.deepEqual(
    emit(all, complete()).map((e) => [e.type, e.payload]),
    [["verification.completed", { cycle: 1, headSha: sha, passed: true }]],
  );
  const v = run(all, complete());
  assert.ok(v.exists && v.state === "review");
});

test("solo errores, sin ningún fail: se rechaza y la tarea sigue en verifying sin gastar ciclo", () => {
  const errored = run(verifying(), ...allGates(1, { typecheck: "error", test: "error" }));
  refuse(errored, complete(), "gate_errors");
  const v = run(errored, gate("typecheck"), gate("test"), complete());
  assert.ok(v.exists && v.state === "review");
  assert.equal(v.building?.cycle, 1);
});

test("un fail gasta ciclo aunque haya errores: vuelve a building con el ciclo siguiente", () => {
  const v = run(verifying(), ...allGates(1, { lint: "error", test: "fail" }), complete());
  assert.ok(v.exists);
  assert.equal(v.state, "building");
  assert.equal(v.building?.cycle, 2);
});

test("al tercer ciclo fallido, task.failed con los gates que dieron fail", () => {
  const third = run(verifying(3), ...allGates(3, { diff_size: "fail", test: "fail" }));
  assert.ok(third.exists);
  const failed = [
    third.building?.gates.diff_size?.gateRunId,
    third.building?.gates.test?.gateRunId,
  ];
  const events = emit(third, complete(3));
  assert.deepEqual(
    events.map((e) => [e.type, e.payload]),
    [
      ["verification.completed", { cycle: 3, headSha: sha, passed: false }],
      ["task.failed", { cycle: 3, failedGates: failed }],
    ],
  );
  const v = events.reduce(evolve, third);
  assert.ok(v.exists && v.state === "failed");
});

const failed: Task = { ...verifying(3), state: "failed" };

test("el humano clasifica una tarea failed una sola vez, con un motivo válido", () => {
  refuse(failed, classify("scope", system), "actor_not_allowed");
  refuse(failed, classify("nope"), "invalid_reason");
  refuse({ ...failed, state: "rejected" }, classify(), "invalid_state");
  refuse(verifying(), classify(), "invalid_state");
  const v = run(failed, classify());
  assert.ok(v.exists && v.building?.failureClassified === true);
  refuse(v, classify(), "failure_already_classified");
});

test("togi libera la copia de trabajo en cualquier estado final, una sola vez", () => {
  for (const state of ["failed", "merged", "rejected"] as const) {
    const final = { ...failed, state };
    refuse(final, release("wsp_1", human), "actor_not_allowed");
    refuse(final, release("wsp_2"), "workspace_mismatch");
    const v = run(final, release());
    assert.ok(v.exists && v.building?.workspaceReleased === true);
    refuse(v, release(), "workspace_already_released");
  }
  refuse(verifying(), release(), "invalid_state");
  const { building: _, ...noCopy } = failed;
  refuse({ ...noCopy, state: "rejected" }, release(), "workspace_mismatch");
});

test("en un estado final el resto de comandos sigue rechazado", () => {
  refuse(failed, gate("lint", "pass", 3), "task_final");
  refuse(failed, complete(3), "task_final");
});
