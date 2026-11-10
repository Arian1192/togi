import assert from "node:assert/strict";
import { test } from "node:test";
import { ReactFlow } from "@xyflow/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MesaFlowEdge } from "./MesaFlowEdge.ts";
import { MesaFlowNode } from "./MesaFlowNode.ts";
import { applyHeader, EMPTY, type Header, type MesaState, type Who } from "./mesa.ts";
import { layout } from "./mesaFlow.ts";

// Cómo se pintan los nodos y las aristas de la mesa en React Flow, sin navegador.

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
const play = (...hs: Header[]) => hs.reduce(applyHeader, EMPTY as MesaState);

const render = (state: MesaState, waiting: number) => {
  const { nodes, edges } = layout(state, waiting, new Map(), new Map([[7, "Exportar a CSV"]]));
  return renderToStaticMarkup(
    createElement(ReactFlow, {
      nodes,
      edges,
      nodeTypes: { mesa: MesaFlowNode },
      edgeTypes: { mesa: MesaFlowEdge },
      width: 880,
      height: 660,
    }),
  );
};

test("los nodos: togi, tú con lo que te espera y cada plaza con su tarea, su rol y su mensaje", () => {
  const out = render(
    play(
      h(1, 7, "session.started", togi, "sa"),
      h(2, 7, "plan.proposed", planner, "sa"),
      h(3, 9, "session.started", togi, "sb"),
      h(4, 9, "session.ended", togi, "sb"),
    ),
    2,
  );
  assert.match(out, /mesa-node is-togi[\s\S]*?>togi<\/span><span class="mesa-note">log · seq 4</);
  assert.match(out, /mesa-node is-you is-waiting[\s\S]*?class="glyph"[\s\S]*?<\/svg>2 te esperan</);
  assert.equal((out.match(/>Planificador</g) ?? []).length, 2);
  assert.match(
    out,
    /mesa-label">#7 · Exportar a CSV<\/span><div class="mesa-node is-active"[\s\S]*?<\/svg>plan\.proposed</,
  );
  assert.match(
    out,
    /mesa-label">#9<\/span><div class="mesa-node is-done"[\s\S]*?<\/svg>terminado</,
  );
  assert.doesNotMatch(out, /[◐○◆]/, "los glifos van como SVG, nunca como carácter");
});

test("los asideros no admiten conexiones: nadie puede unir dos nodos", () => {
  const out = render(play(h(1, 7, "session.started", togi, "sa")), 0);
  assert.match(out, /mesa-handle/);
  assert.doesNotMatch(out, /\bconnectable\b(?!start|end)/);
});

test("cada arista es una curva hasta togi y su último mensaje la recorre en su sentido", () => {
  const out = render(
    play(h(1, 7, "session.started", togi, "sa"), h(2, 7, "plan.proposed", planner, "sa")),
    0,
  );
  assert.equal((out.match(/class="mesa-edge"/g) ?? []).length, 2, "tú y la plaza");
  const pulses = out.match(/<path[^>]*class="mesa-pulse[^"]*"[^>]*>/g) ?? [];
  assert.equal(pulses.length, 1, "solo el último de la plaza");
  assert.match(pulses[0] ?? "", /class="mesa-pulse to-togi"/);
  assert.match(pulses[0] ?? "", /pathLength="1"/);
  assert.match(pulses[0] ?? "", /d="M[\d.]+,[\d.]+ C[\d., ]+ 392,330"/, "termina en togi");
  assert.match(pulses[0] ?? "", /data-event="plan.proposed"/);
});

test("mientras la sesión sigue, un punto recorre su arista; apagada, no", () => {
  const live = render(play(h(1, 7, "session.started", togi, "sa")), 0);
  assert.match(live, /class="mesa-dot to-seat" pathLength="1" d="M392,330 C/);
  const done = render(
    play(h(1, 7, "session.started", togi, "sa"), h(2, 7, "session.ended", togi, "sa")),
    0,
  );
  assert.doesNotMatch(done, /mesa-dot/);
});
