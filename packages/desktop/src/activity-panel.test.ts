import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityPanel, activityVersion, newerOnly } from "./ActivityPanel.ts";
import type { ActivityResult } from "./activityApi.ts";
import { MesaScreen } from "./MesaView.ts";
import { applyHeader, EMPTY, type Header, type LogEntry } from "./mesa.ts";
import type { TaskRow } from "./TaskList.ts";

// La Actividad de una tarea en el panel derecho (ADR-010 §3): al elegir una tarea, el panel enseña
// su línea de tiempo con un chip «#n ✕» para volver a todas. Sin elegir, el panel queda como antes.

const at = "2026-11-11T09:30:00.000Z";
const entry = (seq: number, number: number): LogEntry => ({
  seq,
  at,
  number,
  name: "session.started",
  who: "togi",
});
const started: Header = {
  seq: 1,
  at,
  number: 7,
  name: "session.started",
  actor: { kind: "system", component: "adapter:planner" },
  session: "sa",
};
const task: TaskRow = {
  number: 7,
  title: "Exportar a CSV",
  titleErased: false,
  state: "planning",
  repo: "demo/promos",
  baseBranch: "main",
  hasCriteria: true,
  updatedAt: at,
  version: 1,
};
const never = () => new Promise<ActivityResult>(() => {});
const screen = (selected: number | null) =>
  renderToStaticMarkup(
    createElement(MesaScreen, {
      state: applyHeader(EMPTY, started),
      waiting: 0,
      tasks: [task],
      onOpen: () => {},
      selected,
      readActivity: never,
    }),
  );
const aside = (out: string) => out.slice(out.indexOf("<aside"));

test("la versión de la actividad es el último seq del registro de esa tarea; sin ninguno, 0", () => {
  const log = [entry(3, 7), entry(4, 8), entry(9, 7), entry(12, 8)];
  assert.equal(activityVersion(log, 7), 9);
  assert.equal(activityVersion(log, 8), 12);
  assert.equal(activityVersion(log, 5), 0);
  assert.equal(activityVersion(undefined, 7), 0);
});

test("una respuesta que llega fuera de orden se descarta: solo vale la más nueva que la última", () => {
  const order = newerOnly();
  const first = order.ask();
  const second = order.ask();
  const third = order.ask();
  assert.equal(order.take(second), true);
  assert.equal(order.take(first), false, "más vieja que la ya enseñada");
  assert.equal(order.take(third), true);
  assert.equal(order.take(third), false, "la misma, dos veces");
});

test("con una tarea elegida, el panel enseña su línea de tiempo y el chip para volver", () => {
  const out = aside(screen(7));
  assert.match(
    out,
    /^<aside class="mesa-log" aria-label="Lo último que ha pasado por togi"><h2>Lo último que ha pasado por togi<\/h2>/,
  );
  assert.match(
    out,
    /<div class="mc-head"><button type="button" class="mc-back" aria-label="Volver a todas las tareas">#7 ✕<\/button>/,
  );
  assert.match(out, /Leyendo la actividad…/);
  assert.doesNotMatch(out, /mesa-tasks|mesa-log-all/);
});

test("sin tarea elegida, el panel sigue con las tarjetas y el registro, sin Actividad", () => {
  const out = aside(screen(null));
  assert.match(out, /mesa-tasks/);
  assert.match(out, /mesa-log-all/);
  assert.doesNotMatch(out, /mc-back|Leyendo la actividad/);
});

test("lo leído se pinta con la línea de tiempo y el cuaderno queda a mano", () => {
  const result: ActivityResult = {
    status: "ok",
    items: [
      {
        seq: 1,
        at,
        type: "session.started",
        actor: { kind: "system", component: "adapter:planner" },
        role: "planner",
      },
    ],
    truncated: false,
  };
  const out = renderToStaticMarkup(
    createElement(ActivityPanel, {
      task: 7,
      result,
      now: Date.parse(at),
      onClear: () => {},
      onOpen: () => {},
    }),
  );
  assert.match(
    out,
    /class="mc-back"[^>]*>#7 ✕<\/button><button type="button" class="mesa-card-open">Abrir cuaderno →<\/button><\/div>/,
  );
  assert.match(out, /<div class="mc"><article class="mc-card">/);
});

test("si la lectura falla, solo el mensaje cerrado", () => {
  const out = renderToStaticMarkup(
    createElement(ActivityPanel, {
      task: 7,
      result: { status: "unreachable", reason: "app" },
      now: 0,
      onClear: () => {},
      onOpen: () => {},
    }),
  );
  assert.match(out, /No se pudo leer la actividad de la tarea\./);
  assert.doesNotMatch(out, /class="mc"/);
});

test("la mesa lee con readTaskActivity, empieza de cero al cambiar de tarea y relee con su versión", () => {
  const src = (file: string) => readFileSync(join(import.meta.dirname, file), "utf8");
  const view = src("MesaView.ts");
  assert.match(view, /readActivity \?\? readTaskActivity/);
  assert.match(view, /key: open/);
  assert.match(view, /activityVersion\(state\.log, open\)/);
  const panel = src("ActivityPanel.ts");
  assert.match(panel, /\[task, version, read\]/);
  assert.doesNotMatch(src("MesaPane.tsx"), /readTaskActivity|readActivity/);
});

test("el chip y el cuaderno van en una fila, con los tokens de la marca", () => {
  const css = readFileSync(join(import.meta.dirname, "app.css"), "utf8");
  assert.match(css, /\.mc-head \{[^}]*display: flex/);
  assert.match(css, /\.mc-back \{[^}]*border: 1px solid var\(--border\)/);
  const block = css.slice(
    css.indexOf(".mc-head {"),
    css.indexOf("/* Fin del chip de Actividad */"),
  );
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
});
