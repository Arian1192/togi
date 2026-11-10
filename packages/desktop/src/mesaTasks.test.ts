import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskState } from "@togi/core";
import { applyHeader, EMPTY, type Header, type MesaState } from "./mesa.ts";
import { eventLabel, marks, since, taskCards } from "./mesaTasks.ts";
import type { TaskRow } from "./TaskList.ts";

// El lateral de la mesa por tarea: qué tarjetas salen, en qué orden y cómo va cada una.

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
const h = (seq: number, number: number, name: string): Header => ({
  seq,
  at: `2026-11-10T09:30:0${seq}.000Z`,
  number,
  name,
  actor: { kind: "human" },
});
const play = (...hs: Header[]) => hs.reduce(applyHeader, EMPTY as MesaState);

test("los pasos: el actual late; si te toca a ti, es tuyo; lo anterior, hecho", () => {
  assert.deepEqual(marks("planning"), ["now", "todo", "todo", "todo", "todo", "todo"]);
  assert.deepEqual(marks("plan_review"), ["done", "you", "todo", "todo", "todo", "todo"]);
  assert.deepEqual(marks("verifying"), ["done", "done", "done", "now", "todo", "todo"]);
  assert.deepEqual(marks("review"), ["done", "done", "done", "done", "you", "todo"]);
  assert.deepEqual(marks("merged"), ["done", "done", "done", "done", "done", "done"]);
  assert.deepEqual(marks("failed"), ["done", "done", "done", "failed", "todo", "todo"]);
  assert.equal(marks("draft"), null, "un borrador aún no está en el camino");
  assert.equal(marks("rejected"), null);
});

test("salen lo que te espera, lo que está en curso y lo que se ha movido; lo demás, no", () => {
  const tasks = [
    row(1, "plan_review"),
    row(2, "planning"),
    row(3, "merged"),
    row(4, "draft"),
    row(5, "review"),
  ];
  const cards = taskCards(tasks, play(h(1, 3, "task.completed")));
  assert.deepEqual(
    cards.waiting.map((c) => [c.number, c.chip]),
    [
      [5, "te espera"],
      [1, "te espera"],
    ],
  );
  assert.deepEqual(
    cards.active.map((c) => [c.number, c.chip]),
    [[2, "planificando"]],
  );
  assert.deepEqual(
    cards.recent.map((c) => [c.number, c.chip, c.tone]),
    [[3, "mergeada", "quiet"]],
    "el borrador #4 no se ha movido: no sale",
  );
});

test("en cada grupo, primero lo que se movió más tarde; cada tarjeta, con sus eventos al revés", () => {
  const tasks = [row(1, "planning"), row(2, "planning")];
  const cards = taskCards(
    tasks,
    play(h(1, 1, "task.submitted"), h(2, 2, "task.submitted"), h(3, 1, "session.started")),
  );
  assert.deepEqual(
    cards.active.map((c) => [c.number, c.events.map((e) => e.seq)]),
    [
      [1, [3, 1]],
      [2, [2]],
    ],
  );
});

test("un título borrado no se enseña", () => {
  assert.equal(taskCards([row(1, "planning", null)], EMPTY).active[0]?.title, null);
});

test("cada evento con su nombre para leerlo; uno desconocido, tal cual", () => {
  assert.equal(eventLabel("plan.proposed"), "Plan propuesto");
  assert.equal(eventLabel("task.submitted"), "Enviada a planning");
  assert.equal(eventLabel("gate.progress"), "gate.progress");
});

test("hace cuánto: ahora, segundos, minutos y, pasada una hora, la hora", () => {
  const at = "2026-11-10T09:30:00.000Z";
  const t = Date.parse(at);
  assert.equal(since(at, t + 2_000), "ahora");
  assert.equal(since(at, t + 12_000), "hace 12 s");
  assert.equal(since(at, t + 5 * 60_000), "hace 5 min");
  assert.equal(since(at, t + 2 * 3600_000), "09:30");
});
