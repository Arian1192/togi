import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MesaMap } from "./MesaMap.ts";
import { MesaScreen } from "./MesaView.ts";
import { applyHeader, EMPTY, type Header } from "./mesa.ts";
import { MesaTasksContext } from "./mesaContext.ts";
import type { TaskRow } from "./TaskList.ts";

// El lateral de la mesa por tarea, cableado (4d-5): las tarjetas en el lateral, el registro entero
// plegado al final y la plaza de la tarea abierta marcada en el mapa.

const task: TaskRow = {
  number: 7,
  title: "Exportar a CSV",
  titleErased: false,
  state: "planning",
  repo: "demo/promos",
  baseBranch: "main",
  hasCriteria: true,
  updatedAt: "2026-11-10T09:00:00.000Z",
  version: 1,
};
const started: Header = {
  seq: 1,
  at: "2026-11-10T09:30:00.000Z",
  number: 7,
  name: "session.started",
  actor: { kind: "system", component: "adapter:planner" },
  session: "sa",
};
const state = applyHeader(EMPTY, started);
const read = (file: string) => readFileSync(join(import.meta.dirname, file), "utf8");

test("el lateral lleva las tarjetas de las tareas y, plegado al final, el registro entero", () => {
  const out = renderToStaticMarkup(
    createElement(MesaScreen, { state, waiting: 0, tasks: [task], onOpen: () => {} }),
  );
  const aside = out.slice(out.indexOf('<aside class="mesa-log"'));
  assert.match(aside, /<h2>Lo último que ha pasado por togi<\/h2><div class="mesa-tasks">/);
  assert.match(aside, /mesa-card is-active[\s\S]*?#7[\s\S]*?Exportar a CSV/);
  assert.match(
    aside,
    /<details class="mesa-log-all"><summary>Registro completo · 1<\/summary><ol>/,
  );
});

test("las tareas llegan por el contexto que pone la app", () => {
  const out = renderToStaticMarkup(
    createElement(
      MesaTasksContext.Provider,
      { value: { tasks: [task], onOpen: () => {} } },
      createElement(MesaScreen, { state, waiting: 0 }),
    ),
  );
  assert.match(out, /mesa-card is-active/);
});

test("sin tareas, el lateral no pinta tarjetas", () => {
  const out = renderToStaticMarkup(createElement(MesaScreen, { state, waiting: 0 }));
  assert.doesNotMatch(out, /mesa-tasks/);
});

test("la plaza de la tarea abierta en el lateral se marca en el mapa", () => {
  const marked = (selected: number | null) =>
    renderToStaticMarkup(createElement(MesaMap, { state, waiting: 0, selected }));
  assert.match(marked(7), /react-flow__node[^"]* is-selected[^"]*"[^>]*data-id="sa"/);
  assert.doesNotMatch(marked(null), /is-selected/);
});

test("la app da a la mesa las tareas y «Abrir cuaderno →» la lleva al cuaderno de la tarea", () => {
  const app = read("App.tsx");
  assert.match(app, /<MesaTasksContext\.Provider[\s\S]*?tasks: list\.tasks/);
  assert.match(app, /onOpen: \(number\) => setView\(\{ kind: "task", number \}\)/);
});
