import assert from "node:assert/strict";
import { test } from "node:test";
import { applyHeader, EMPTY, type Header, type MesaState, type Who } from "./mesa.ts";
import { layout, linkEdges } from "./mesaFlow.ts";

// Las aristas de la mesa que se puede mover: todas van a togi, llevan su último mensaje y, mientras
// la sesión sigue, un punto que no para.

const at = "2026-11-10T09:30:00.000Z";
const h = (seq: number, number: number, name: string, actor: Who, session?: string): Header => ({
  seq,
  at,
  number,
  name,
  actor,
  ...(session === undefined ? {} : { session }),
});
const togi: Who = { kind: "system", component: "adapter:planner" };
const planner: Who = { kind: "agent", role: "planner" };
const play = (state: MesaState, ...hs: Header[]) => hs.reduce(applyHeader, state);

test("toda arista va a togi: ningún agente queda unido a otro", () => {
  const s = play(
    EMPTY,
    h(1, 7, "session.started", togi, "sa"),
    h(2, 8, "session.started", togi, "sb"),
    h(3, 9, "decision.recorded", { kind: "human" }),
  );
  const edges = linkEdges(s, 1);
  assert.ok(edges.every((e) => e.target === "togi"));
  assert.deepEqual(
    edges.map((e) => e.source),
    ["you", "sa", "sb"],
  );
  assert.equal(edges[0]?.data?.pulse?.name, "decision.recorded");
  assert.ok(edges.every((e) => e.selectable === false && e.focusable === false));
});

test("cada arista sale por el lado que mira a togi y entra por el lado de togi que la mira", () => {
  const s = play(
    EMPTY,
    h(1, 7, "session.started", togi, "sa"),
    h(2, 8, "session.started", togi, "sb"),
  );
  assert.deepEqual(
    linkEdges(s, 0).map((e) => [e.source, e.sourceHandle, e.targetHandle]),
    [
      ["you", "bottom", "top"],
      ["sa", "right", "left"],
      ["sb", "left", "right"],
    ],
  );
});

test("la arista lleva su último mensaje como etiqueta y, si la sesión sigue, un punto que no para", () => {
  const s = play(
    EMPTY,
    h(1, 7, "session.started", togi, "sa"),
    h(2, 7, "plan.proposed", planner, "sa"),
    h(3, 8, "session.started", togi, "sb"),
    h(4, 8, "session.ended", togi, "sb"),
    h(5, 9, "task.submitted", { kind: "human" }),
  );
  const data = (id: string, waiting: number) =>
    linkEdges(s, waiting).find((e) => e.source === id)?.data;
  assert.deepEqual(
    [data("sa", 0)?.tone, data("sa", 0)?.chip, data("sa", 0)?.flow],
    ["is-active", "plan.proposed", "togi"],
  );
  assert.deepEqual(
    [data("sb", 0)?.tone, data("sb", 0)?.flow],
    ["is-done", null],
    "apagada, quieta",
  );
  assert.equal(data("you", 0)?.chip, "#9 task.submitted");
  assert.equal(data("you", 0)?.flow, null, "nada te espera: tu arista, quieta");
  assert.equal(data("you", 2)?.flow, "seat", "algo te espera: un punto viaja de togi hacia ti");
});

test("con más plazas de las que caben, el mensaje de una oculta recorre la arista de «+N más»", () => {
  const hs = Array.from({ length: 10 }, (_, i) =>
    h(i + 1, 10 + i, "session.started", togi, `s${i}`),
  );
  const { nodes, edges, active } = layout(play(EMPTY, ...hs), 0);
  const more = edges.find((e) => e.source === "more")?.data;
  assert.deepEqual([more?.tone, more?.pulse?.seq, more?.flow], ["is-more", 10, "seat"]);
  assert.equal(edges.length, 1 + 7 + 1, "tú, 7 plazas y «+N más»");
  assert.equal(nodes.length, edges.length + 1, "y togi, que no tiene arista propia");
  assert.equal(active, 10);
});
