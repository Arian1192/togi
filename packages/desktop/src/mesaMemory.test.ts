import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MesaMap } from "./MesaMap.ts";
import { applyHeader, EMPTY, type Header } from "./mesa.ts";
import { mesaMemory } from "./mesaMemory.ts";

// La mesa recuerda dónde la dejaste aunque cambies a las tareas (⌘1) y vuelvas (⌘2).

const started: Header = {
  seq: 1,
  at: "2026-11-10T09:30:00.000Z",
  number: 7,
  name: "session.started",
  actor: { kind: "system", component: "adapter:planner" },
  session: "sa",
};
const render = () =>
  renderToStaticMarkup(createElement(MesaMap, { state: applyHeader(EMPTY, started), waiting: 0 }));

afterEach(() => {
  mesaMemory.moved = new Map();
  mesaMemory.viewport = null;
  mesaMemory.ids = null;
});

test("un nodo que moviste vuelve a su sitio al volver a la mesa", () => {
  mesaMemory.moved = new Map([["sa", { x: 10, y: 20 }]]);
  assert.match(render(), /transform:translate\(10px,20px\)[^"]*"[^>]*data-id="sa"/);
});

// React Flow aplica `defaultViewport` ya en el navegador; sin él solo se ve que no reencuadra.
test("con un encuadre que recordar, al volver no reencuadra", () => {
  mesaMemory.viewport = { x: 5, y: 6, zoom: 0.5 };
  assert.match(
    render(),
    /react-flow__viewport[^"]*" style="transform:translate\(0px,0px\) scale\(1\)"/,
  );
});

test("la primera vez, sin nada que recordar, encuadra la mesa", () => {
  assert.doesNotMatch(render(), /translate\(0px,0px\) scale\(1\)"/, "fitView movió el encuadre");
});
