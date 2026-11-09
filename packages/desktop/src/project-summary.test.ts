import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TaskState } from "@togi/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectColumn } from "./ProjectColumn.ts";
import { ProjectSummary } from "./ProjectSummary.ts";
import { buildProjects, summaryOf } from "./projects.ts";
import type { TaskRow } from "./TaskList.ts";
import { PENDING } from "./viewState.ts";

const SRC = import.meta.dirname;
const css = readFileSync(join(SRC, "app.css"), "utf8");
const app = readFileSync(join(SRC, "App.tsx"), "utf8");

const row = (number: number, state: string, repo = "arian1192/togi"): TaskRow => ({
  number,
  title: `tarea ${number}`,
  titleErased: false,
  state: state as TaskState,
  repo,
  baseBranch: "main",
  hasCriteria: true,
  updatedAt: "2026-11-07T10:00:00Z",
  version: 1,
});
const TASKS = [
  row(1, "merged"),
  row(2, "plan_review"),
  row(3, "building"),
  row(4, "draft"),
  row(5, "rejected"),
  row(6, "failed"),
  row(7, "verifying"),
  row(8, "teleported"),
];
const project = (tasks = TASKS) => {
  const found = buildProjects(tasks, false).projects[0];
  assert.ok(found);
  return found;
};
const numbers = (rows: TaskRow[]) => rows.map((t) => t.number);

test("el resumen reparte las tareas en lo que te espera, lo en curso y los borradores, y cuenta las cerradas", () => {
  const s = summaryOf(project());
  assert.deepEqual(numbers(s.waiting), [2, 6]);
  assert.deepEqual(numbers(s.active), [3, 7]);
  assert.deepEqual(numbers(s.drafts), [4]);
  assert.equal(s.closed, 2);
});

test("un estado que esta versión no conoce no cae en ningún grupo del resumen", () => {
  const s = summaryOf(project());
  const all = [...s.waiting, ...s.active, ...s.drafts].map((t) => t.number);
  assert.ok(!all.includes(8));
});

const html = (tasks = TASKS, partial = false) =>
  renderToStaticMarkup(createElement(ProjectSummary, { project: project(tasks), partial }));

test("el resumen lleva el nombre del proyecto como título, el repo en mono y el número de tareas", () => {
  const out = html();
  assert.match(out, /<h1[^>]*>togi<\/h1>/);
  assert.match(out, /<code[^>]*>arian1192\/togi<\/code>/);
  assert.match(out, /8 tareas/);
});

test("las secciones llevan su kanji y nombre, en este orden, y las vacías no se pintan", () => {
  const out = html();
  const at = ["一", "Pendiente de ti", "二", "En curso", "三", "Borradores"].map((t) =>
    out.indexOf(t),
  );
  assert.ok(
    at.every((i) => i > -1),
    "falta una sección",
  );
  assert.deepEqual(
    [...at].sort((a, b) => a - b),
    at,
  );
  const only = html([row(1, "building")]);
  assert.doesNotMatch(only, /Pendiente de ti|Borradores/);
  assert.match(only, /En curso/);
});

test("las cerradas son una línea con su número, en singular y plural, y con «+» si la lista es parcial", () => {
  assert.match(html(), /2 cerradas/);
  assert.match(html([row(1, "merged")]), /1 cerrada(?!s)/);
  assert.match(html(TASKS, true), /2\+ cerradas/);
  assert.doesNotMatch(html([row(1, "draft")]), /cerrada/);
});

test("las tareas del resumen se listan con el mismo aspecto que las del centro", () => {
  const out = html();
  assert.match(out, /task-row/);
  assert.match(out, /#2</);
  assert.ok(!out.includes("#1<"), "una cerrada no se lista");
});

test("un proyecto cuyas tareas están todas cerradas dice cuántas, y uno sin tareas, nada raro", () => {
  const col = (tasks: TaskRow[]) =>
    renderToStaticMarkup(
      createElement(ProjectColumn, {
        data: buildProjects(tasks, false),
        view: PENDING,
        closed: new Set<string>(),
        onView: () => {},
        onToggle: () => {},
      }),
    );
  const out = col([row(1, "merged"), row(2, "rejected")]);
  assert.match(out, /class="col-empty">2 cerradas</);
  assert.doesNotMatch(col([row(1, "building")]), /col-empty/);
});

test("el número de «Pendiente de ti» y el de cada proyecto se centran con su glifo", () => {
  assert.match(css, /\.col-counts \{[^}]*align-items: center/);
});

test("el centro muestra el resumen del proyecto elegido y el cuaderno-lista para lo demás", () => {
  assert.match(app, /<ProjectSummary/);
  assert.match(app, /view\.kind === "project"/);
});
