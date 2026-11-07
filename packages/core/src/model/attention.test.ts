import assert from "node:assert/strict";
import { test } from "node:test";
import { ATTENTION_GROUPS, attentionGroup, stateColor, statesIn } from "./attention.ts";
import { STATE_BRAND } from "./state-brand.ts";
import { TASK_STATES, type TaskState } from "./task.ts";

// Las tres listas que `togi status` tenía escritas a mano: la agrupación por quién tiene que actuar.
const BY_ACTOR = {
  pending: ["draft", "plan_review", "review", "failed"],
  active: ["planning", "building", "verifying"],
  closed: ["merged", "rejected"],
} as const;

test("cada estado está en el grupo de quién tiene que actuar, igual que en togi status", () => {
  for (const group of ATTENTION_GROUPS) {
    assert.deepEqual(statesIn(group), BY_ACTOR[group], group);
    for (const state of BY_ACTOR[group]) assert.equal(attentionGroup(state), group, state);
  }
});

test("los grupos reparten los nueve estados: ninguno falta y ninguno está en dos", () => {
  assert.deepEqual(ATTENTION_GROUPS, ["pending", "active", "closed"]);
  const all = ATTENTION_GROUPS.flatMap(statesIn);
  assert.equal(all.length, TASK_STATES.length);
  assert.deepEqual([...all].sort(), [...TASK_STATES].sort());
});

test("la agrupación no sale del color: draft es ink-muted y está en «pendiente»", () => {
  assert.equal(STATE_BRAND.draft.token, "ink-muted");
  assert.equal(attentionGroup("draft"), "pending");
  // rejected tiene el mismo color que draft y está en otro grupo.
  assert.equal(STATE_BRAND.rejected.token, STATE_BRAND.draft.token);
  assert.equal(attentionGroup("rejected"), "closed");
  // Los de token human están todos pendientes, pero no todos los pendientes son human.
  for (const state of TASK_STATES.filter((s) => STATE_BRAND[s].token === "human")) {
    assert.equal(attentionGroup(state), "pending", state);
  }
});

test("un estado que esta versión no conoce va a «cerradas»", () => {
  assert.equal(attentionGroup("otro" as TaskState), "closed");
});

test("stateColor da el color de marca de cada estado, sin la palabra token en el código que lo usa", () => {
  for (const state of TASK_STATES) assert.equal(stateColor(state), STATE_BRAND[state].token, state);
  assert.deepEqual([...new Set(TASK_STATES.map(stateColor))].sort(), [
    "agent",
    "done",
    "human",
    "ink-muted",
  ]);
});
