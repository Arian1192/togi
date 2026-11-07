import assert from "node:assert/strict";
import { test } from "node:test";
import { TASK_STATES, type TaskState } from "@togi/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GROUP_LABEL, groupTasks, TaskList, type TaskRow } from "./TaskList.ts";

const row = (number: number, state: string, extra: Partial<TaskRow> = {}): TaskRow => ({
  number,
  title: `tarea ${number}`,
  titleErased: false,
  state: state as TaskState,
  hasCriteria: true,
  updatedAt: "2026-11-07T10:00:00Z",
  version: 1,
  ...extra,
});
const html = (tasks: TaskRow[], truncated = false) =>
  renderToStaticMarkup(createElement(TaskList, { tasks, truncated }));

test("los grupos llevan los nombres de togi status", () => {
  assert.deepEqual(GROUP_LABEL, {
    pending: "Pendiente de ti",
    active: "En curso",
    closed: "Cerradas",
  });
});

test("cada uno de los nueve estados cae en el grupo de attentionGroup", () => {
  const tasks = TASK_STATES.map((state, i) => row(i + 1, state));
  const g = groupTasks(tasks);
  assert.deepEqual(
    g.pending.map((t) => t.state),
    ["draft", "plan_review", "review", "failed"],
  );
  assert.deepEqual(
    g.active.map((t) => t.state),
    ["planning", "building", "verifying"],
  );
  assert.deepEqual(
    g.closed.map((t) => t.state),
    ["merged", "rejected"],
  );
});

test("un estado desconocido va a cerradas y se pinta en gris sin romper", () => {
  const out = html([row(1, "archived")]);
  assert.match(out, /<details/);
  assert.match(out, /tone-ink-muted/);
  assert.doesNotMatch(out, /<svg/);
});

test("el orden de los grupos es pendiente, en curso, cerradas, y los vacíos no salen", () => {
  const out = html([row(1, "merged"), row(2, "building"), row(3, "review")]);
  const at = (text: string) => out.indexOf(text);
  assert.ok(
    at("Pendiente de ti · 1") < at("En curso · 1") && at("En curso · 1") < at("Cerradas · 1"),
  );
  assert.doesNotMatch(html([row(1, "review")]), /En curso|Cerradas/);
});

test("las cerradas van plegadas y las demás no", () => {
  const out = html([row(1, "merged"), row(2, "review")]);
  assert.match(out, /<details class="task-group"><summary>Cerradas · 1<\/summary>/);
  assert.match(out, /<section class="task-group"><h2>Pendiente de ti · 1<\/h2>/);
});

test("la fila lleva el glifo, el estado con su color, el número en mono y el título", () => {
  const out = html([row(7, "review", { title: "Subir el timeout" })]);
  assert.match(out, /tone-human/);
  assert.match(out, /<svg class="glyph"/);
  assert.match(out, /<code class="ident">#7<\/code>/);
  assert.match(out, /Subir el timeout/);
});

test("el título borrado o ausente sale como [borrado]; el texto se escapa", () => {
  assert.match(html([row(1, "review", { titleErased: true })]), /\[borrado\]/);
  assert.match(html([row(1, "review", { title: null })]), /\[borrado\]/);
  assert.match(html([row(1, "review", { title: "<b>x</b>" })]), /&lt;b&gt;x&lt;\/b&gt;/);
});

test("falta criterio solo sale cuando no hay criterios", () => {
  assert.match(html([row(1, "draft", { hasCriteria: false })]), /falta criterio/);
  assert.doesNotMatch(html([row(1, "draft")]), /falta criterio/);
});

test("sin tareas lo dice, y truncada avisa de que puede haber más", () => {
  assert.match(html([]), /No hay tareas\./);
  assert.match(html([row(1, "review")], true), /puede haber más/);
  assert.doesNotMatch(html([row(1, "review")]), /puede haber más/);
});
