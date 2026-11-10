import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskState } from "@togi/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MesaCards } from "./MesaCards.ts";
import { applyHeader, EMPTY, type Header, type MesaState } from "./mesa.ts";
import { taskCards } from "./mesaTasks.ts";
import type { TaskRow } from "./TaskList.ts";

// Cómo se pinta el lateral de la mesa por tarea: tarjetas cerradas y la desplegada.

const row = (number: number, state: TaskState, title: string | null = `T${number}`): TaskRow => ({
  number,
  title,
  titleErased: title === null,
  state,
  repo: "demo/promos",
  baseBranch: "main",
  hasCriteria: true,
  updatedAt: "2026-11-10T09:00:00.000Z",
  version: 1,
});
const at = "2026-11-10T09:30:00.000Z";
const now = Date.parse(at) + 12_000;
const h = (seq: number, number: number, name: string): Header => ({
  seq,
  at,
  number,
  name,
  actor: { kind: "human" },
});
const play = (...hs: Header[]) => hs.reduce(applyHeader, EMPTY as MesaState);
const noop = () => {};
const render = (tasks: TaskRow[], state: MesaState, open: number | null = null) =>
  renderToStaticMarkup(
    createElement(MesaCards, {
      cards: taskCards(tasks, state),
      open,
      onToggle: noop,
      onOpen: noop,
      now,
    }),
  );

test("una tarjeta cerrada: su número, su título, su estado, sus pasos y lo último que le pasó", () => {
  const out = render([row(7, "planning", "Exportar a CSV")], play(h(1, 7, "task.submitted")));
  assert.match(
    out,
    /<li class="mesa-card is-active"><button type="button" class="mesa-card-head" aria-expanded="false"><span class="mesa-card-number">#7<\/span><span class="mesa-card-title">Exportar a CSV<\/span><span class="mesa-card-chip">planificando<\/span><\/button>/,
  );
  assert.match(out, /<li class="mesa-step is-now">[\s\S]*?>plan</);
  assert.equal((out.match(/class="mesa-step is-todo"/g) ?? []).length, 5);
  assert.match(out, /mesa-card-last">Enviada a planning · tú → togi · hace 12 s</);
  assert.match(out, /1 en curso/);
});

test("desplegada: su línea de tiempo y la salida al cuaderno, en vez de la última línea", () => {
  const out = render(
    [row(7, "planning")],
    play(h(1, 7, "task.created"), h(2, 7, "task.submitted")),
    7,
  );
  assert.match(out, /mesa-card is-active is-open/);
  assert.match(out, /aria-expanded="true"/);
  const events = [...out.matchAll(/mesa-event-name">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(events, ["Enviada a planning", "Tarea creada"]);
  assert.match(out, /mesa-event-who">tú → togi · seq 2</);
  assert.match(out, /class="mesa-card-open">Abrir cuaderno →</);
  assert.doesNotMatch(out, /mesa-card-last/);
});

test("lo que te espera va arriba y, si son más de tres, el resto queda en «+N más»", () => {
  const tasks = [1, 2, 3, 4, 5].map((n) => row(n, "plan_review"));
  const out = render([...tasks, row(9, "planning")], EMPTY);
  assert.equal((out.match(/mesa-card is-you/g) ?? []).length, 3);
  assert.match(out, /\+2 más te esperan · ⌘1/);
  assert.match(out, / · 5 te esperan/);
  assert.ok(out.indexOf("is-you") < out.indexOf("is-active"), "primero lo tuyo");
});

test("la tarjeta abierta se queda aunque no quepa entre las tres primeras", () => {
  const tasks = [1, 2, 3, 4].map((n) => row(n, "plan_review"));
  const out = render(tasks, EMPTY, 1);
  assert.match(out, /mesa-card is-you is-open[\s\S]*?#1</);
  assert.equal((out.match(/mesa-card is-you/g) ?? []).length, 4);
  assert.doesNotMatch(out, /más te esperan/);
});

test("un título borrado no se enseña; sin nada que enseñar, lo dice", () => {
  assert.match(render([row(1, "planning", null)], EMPTY), /mesa-card-title">\[borrado\]</);
  assert.match(render([row(1, "draft")], EMPTY), /Ninguna tarea en marcha\./);
});
