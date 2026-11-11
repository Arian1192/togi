import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActivityItem } from "./activityApi.ts";
import { activityFeed, usageParts } from "./activityFeed.ts";

// La línea de tiempo de Actividad (ADR-010 §3, panel derecho): los cambios de estado salen de
// `stateAfter` de @togi/core; cada sesión es una tarjeta con su uso, y cada verificación de togi,
// otra con sus gates.

const at = "2026-11-11T09:30:00.000Z";
const togi = { kind: "system", component: "adapter:planner" } as const;
const human = { kind: "human" } as const;
const item = (seq: number, type: ActivityItem["type"], extra: Partial<ActivityItem> = {}) =>
  ({ seq, at, type, actor: togi, ...extra }) as ActivityItem;

const usage = {
  durationMs: 240_000,
  inputTokens: 150_000,
  outputTokens: 36_000,
  estimatedCostUsd: 0.38,
};

test("cada cambio de estado es una línea con quién lo hizo y adónde va", () => {
  const feed = activityFeed([
    item(1, "task.created", { actor: human }),
    item(2, "task.edited", { actor: human }),
    item(3, "task.submitted", { actor: human }),
  ]);
  assert.deepEqual(
    feed.map((e) => (e.kind === "state" ? [e.seq, e.who, e.state] : e.kind)),
    [
      [1, "tú", "draft"],
      [3, "tú", "planning"],
    ],
  );
});

test("la decisión lleva al estado de su veredicto; sin veredicto, no hay línea", () => {
  const feed = activityFeed([
    item(1, "decision.recorded", { actor: human, verdict: "approve" }),
    item(2, "decision.recorded", { actor: human }),
  ]);
  assert.deepEqual(
    feed.map((e) => e.kind === "state" && e.state),
    ["building"],
  );
});

test("un estado que esta versión no conoce no pinta línea", () => {
  const feed = activityFeed([item(1, "task.split" as ActivityItem["type"])]);
  assert.deepEqual(feed, []);
});

test("la sesión es una tarjeta con su especialista, runtime y modelo, y el uso de su cierre", () => {
  const feed = activityFeed([
    item(1, "task.submitted", { actor: human }),
    item(2, "session.started", {
      role: "planner",
      specialist: "generic-planner@2",
      runtime: "claude-agent-sdk@1",
      model: "claude-sonnet-5-5",
      sessionId: "s1",
    }),
    item(3, "session.ended", { sessionId: "s1", outcome: "completed", failureReason: null, usage }),
  ]);
  assert.equal(feed.length, 2);
  assert.deepEqual(feed[0], {
    kind: "state",
    seq: 1,
    at,
    who: "tú",
    state: "planning",
    handoff: "Planificador",
  });
  assert.deepEqual(feed[1], {
    kind: "session",
    seq: 2,
    at,
    role: "Planificador",
    specialist: "generic-planner@2",
    runtime: "claude-agent-sdk@1",
    model: "claude-sonnet-5-5",
    usage,
    outcome: "completed",
    failureReason: null,
  });
});

test("una sesión sin cierre no tiene uso; un cierre sin su inicio no pinta nada", () => {
  const feed = activityFeed([
    item(1, "session.ended", { sessionId: "s0", outcome: "completed", usage }),
    item(2, "session.started", { role: "builder", sessionId: "s1" }),
  ]);
  assert.equal(feed.length, 1);
  const [card] = feed;
  assert.ok(card?.kind === "session");
  assert.equal(card.role, "Constructor");
  assert.equal(card.usage, null);
  assert.equal(card.outcome, null);
  assert.equal(card.specialist, null);
});

test("la entrega solo se anota en la línea de estado que va justo antes de la sesión", () => {
  const feed = activityFeed([
    item(1, "session.started", { role: "planner", sessionId: "s1" }),
    item(2, "session.started", { role: "builder", sessionId: "s2" }),
  ]);
  assert.deepEqual(
    feed.map((e) => e.kind),
    ["session", "session"],
  );
});

test("la verificación de togi lleva los gates de su ciclo y, después, la línea de su estado", () => {
  const feed = activityFeed([
    item(1, "build.submitted", { cycle: 1, headSha: "a3f9c21" }),
    item(2, "gate.completed", { cycle: 1, gate: "typecheck", status: "pass", durationMs: 900 }),
    item(3, "gate.completed", { cycle: 1, gate: "test", status: "fail", durationMs: 4000 }),
    item(4, "verification.completed", { cycle: 1, headSha: "a3f9c21", passed: false }),
    item(5, "session.started", { role: "builder", sessionId: "s2" }),
  ]);
  assert.deepEqual(
    feed.map((e) => [e.seq, e.kind]),
    [
      [1, "state"],
      [4, "verification"],
      [4, "state"],
      [5, "session"],
    ],
  );
  assert.deepEqual(feed[1], {
    kind: "verification",
    seq: 4,
    at,
    cycle: 1,
    headSha: "a3f9c21",
    passed: false,
    gates: [
      { gate: "typecheck", status: "pass" },
      { gate: "test", status: "fail" },
    ],
  });
  assert.ok(feed[2]?.kind === "state");
  assert.equal(feed[2].state, "building");
  assert.equal(feed[2].handoff, "Constructor");
});

test("los gates de otro ciclo no entran; los que aún no tienen veredicto son una verificación en curso", () => {
  const feed = activityFeed([
    item(1, "gate.completed", { cycle: 1, gate: "lint", status: "pass" }),
    item(2, "verification.completed", { cycle: 2, passed: true }),
    item(3, "gate.completed", { cycle: 3, gate: "lint", status: "error" }),
  ]);
  const cards = feed.filter((e) => e.kind === "verification");
  assert.deepEqual(
    cards.map((c) => [c.seq, c.cycle, c.passed, c.gates.length]),
    [
      [2, 2, true, 0],
      [3, 3, null, 1],
    ],
  );
});

test("un gate que no pudo ejecutarse y se repite cuenta una vez, con su último resultado", () => {
  const feed = activityFeed([
    item(1, "gate.completed", { cycle: 1, gate: "lint", status: "error" }),
    item(2, "gate.completed", { cycle: 1, gate: "lint", status: "pass" }),
    item(3, "verification.completed", { cycle: 1, passed: true }),
  ]);
  assert.ok(feed[0]?.kind === "verification");
  assert.deepEqual(feed[0].gates, [{ gate: "lint", status: "pass" }]);
});

test("el uso, para leerlo: duración, tokens y coste", () => {
  assert.deepEqual(usageParts(usage), ["4 min", "186k tokens", "$0,38"]);
  assert.deepEqual(
    usageParts({ durationMs: 45_000, inputTokens: 600, outputTokens: 250, estimatedCostUsd: 0 }),
    ["45 s", "850 tokens", "$0,00"],
  );
});
