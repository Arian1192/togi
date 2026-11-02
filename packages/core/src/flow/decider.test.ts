import assert from "node:assert/strict";
import { test } from "node:test";
import type { BlobRef } from "../model/blob.ts";
import type { Actor } from "../model/ids.ts";
import { type ReasonCategory, TASK_STATES, type TaskState } from "../model/task.ts";
import type { TaskCommand } from "./commands.ts";
import { decide } from "./decider.ts";
import { type DomainErrorCode, isDomainError } from "./errors.ts";
import type { FlowPolicy } from "./policy.ts";
import { evolve, type NewTaskEvent, NO_TASK, type TaskView } from "./task-view.ts";

const policy: FlowPolicy = { maxLines: 300, maxFailedCycles: 3 };
const actor: Actor = { kind: "human", userId: "usr_1" };
const meta = { actor, at: "2026-11-03T10:00:00Z" };
const blob = (n: string): BlobRef => ({
  hash: `sha256:${n}`,
  keyId: "k1",
  dataClass: "task_text",
});

const create: TaskCommand = {
  ...meta,
  type: "create",
  title: "Añadir filtro",
  description: null,
  acceptanceCriteria: blob("ac"),
  risk: "low",
  repo: "Arian1192/promos",
  baseBranch: "dev",
  source: { kind: "cli" },
};
const edit: TaskCommand = { ...meta, type: "edit", changes: { title: "Otro título" } };
const submit: TaskCommand = { ...meta, type: "submit" };
const reject = (category: ReasonCategory = "scope"): TaskCommand => ({
  ...meta,
  type: "reject",
  reason: { category, text: blob("why") },
});

const view = (state: TaskState, over: Partial<TaskView & { exists: true }> = {}): TaskView => ({
  exists: true,
  state,
  title: "Añadir filtro",
  description: null,
  acceptanceCriteria: blob("ac"),
  risk: "low",
  ...over,
});

function expectError(v: TaskView, cmd: TaskCommand, code: DomainErrorCode) {
  const result = decide(v, cmd, policy);
  assert.ok(isDomainError(result), `${cmd.type} sobre ${v.exists ? v.state : "nada"} debía fallar`);
  assert.equal(result.code, code);
}

function expectEvents(v: TaskView, cmd: TaskCommand): NewTaskEvent[] {
  const result = decide(v, cmd, policy);
  assert.ok(!isDomainError(result), "no debía fallar");
  return result;
}

test("create sobre una tarea inexistente produce draft", () => {
  const events = expectEvents(NO_TASK, create);
  assert.deepEqual(
    events.map((e) => e.type),
    ["task.created"],
  );
  const next = events.reduce(evolve, NO_TASK);
  assert.ok(next.exists && next.state === "draft");
});

test("create sobre una tarea existente falla", () => {
  expectError(view("draft"), create, "task_already_exists");
});

test("edit solo en draft", () => {
  assert.deepEqual(
    expectEvents(view("draft"), edit).map((e) => e.type),
    ["task.edited"],
  );
  for (const state of TASK_STATES.filter(
    (s) => s !== "draft" && s !== "merged" && s !== "failed" && s !== "rejected",
  )) {
    expectError(view(state), edit, "invalid_state");
  }
});

test("edit vacío falla", () => {
  expectError(view("draft"), { ...meta, type: "edit", changes: {} }, "empty_edit");
});

test("submit desde draft con criterio y riesgo", () => {
  assert.deepEqual(
    expectEvents(view("draft"), submit).map((e) => e.type),
    ["task.submitted"],
  );
});

test("submit exige criterio de aceptación no null", () => {
  expectError(view("draft", { acceptanceCriteria: null }), submit, "missing_acceptance_criteria");
});

test("submit comprueba el riesgo aunque el flujo normal ya lo garantice", () => {
  const sinRiesgo = { ...view("draft"), risk: undefined } as unknown as TaskView;
  expectError(sinRiesgo, submit, "missing_risk");
});

test("submit solo desde draft", () => {
  for (const state of ["planning", "plan_review", "building", "verifying", "review"] as const) {
    expectError(view(state), submit, "invalid_state");
  }
});

test("reject es válido desde cualquier estado no final", () => {
  for (const state of [
    "draft",
    "planning",
    "plan_review",
    "building",
    "verifying",
    "review",
  ] as const) {
    assert.deepEqual(
      expectEvents(view(state), reject()).map((e) => e.type),
      ["task.rejected"],
    );
  }
});

test("reject exige motivo con categoría válida", () => {
  expectError(view("draft"), reject("nope" as ReasonCategory), "invalid_reason");
});

test("merged, failed y rejected no aceptan ningún comando", () => {
  for (const state of ["merged", "failed", "rejected"] as const) {
    for (const cmd of [edit, submit, reject()]) expectError(view(state), cmd, "task_final");
  }
  expectError(NO_TASK, submit, "task_not_found");
});

test("evolve: created, edited, submitted", () => {
  const events: NewTaskEvent[] = [
    ...expectEvents(NO_TASK, create),
    {
      ...meta,
      schemaVersion: 1,
      type: "task.edited",
      payload: { title: "Nuevo", description: blob("d") },
    },
    { ...meta, schemaVersion: 1, type: "task.submitted", payload: {} },
  ];
  assert.deepEqual(events.reduce(evolve, NO_TASK), {
    exists: true,
    state: "planning",
    title: "Nuevo",
    description: blob("d"),
    acceptanceCriteria: blob("ac"),
    risk: "low",
  });
});

test("evolve: created, rejected", () => {
  const events: NewTaskEvent[] = [
    ...expectEvents(NO_TASK, create),
    ...expectEvents(view("draft"), reject()),
  ];
  const final = events.reduce(evolve, NO_TASK);
  assert.ok(final.exists && final.state === "rejected");
});
