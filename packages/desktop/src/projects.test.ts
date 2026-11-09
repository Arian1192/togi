import assert from "node:assert/strict";
import { test } from "node:test";
import { TASK_STATES, type TaskState } from "@togi/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildProjects } from "./projects.ts";
import { TaskList, type TaskRow } from "./TaskList.ts";

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

test("agrupa las tareas por repo y cuenta lo que espera, lo que está en curso, los borradores y lo cerrado", () => {
  const tasks = [
    row(1, "plan_review"),
    row(2, "review"),
    row(3, "failed"),
    row(4, "building"),
    row(5, "verifying"),
    row(6, "draft"),
    row(7, "merged"),
    row(8, "rejected"),
    row(9, "planning", "arian1192/promos"),
  ];
  const { projects } = buildProjects(tasks, false);
  const togi = projects.find((p) => p.repo === "arian1192/togi");
  assert.deepEqual(togi?.counts, { waiting: 3, active: 2, drafts: 1, closed: 2 });
  assert.equal(togi?.tasks.length, 8);
  const promos = projects.find((p) => p.repo === "arian1192/promos");
  assert.deepEqual(promos?.counts, { waiting: 0, active: 1, drafts: 0, closed: 0 });
});

test("el nombre es el del repo sin su dueño, salvo que dos repos compartan nombre", () => {
  const short = buildProjects([row(1, "draft"), row(2, "draft", "arian1192/promos")], false);
  assert.deepEqual(short.projects.map((p) => p.name).sort(), ["promos", "togi"]);
  const clash = buildProjects([row(1, "draft", "a/web"), row(2, "draft", "b/web")], false);
  assert.deepEqual(clash.projects.map((p) => p.name).sort(), ["a/web", "b/web"]);
});

test("los proyectos con algo que te espera van primero y después, por nombre", () => {
  const tasks = [
    row(1, "building", "o/zeta"),
    row(2, "draft", "o/alfa"),
    row(3, "plan_review", "o/medio"),
  ];
  const { projects } = buildProjects(tasks, false);
  assert.deepEqual(
    projects.map((p) => p.name),
    ["medio", "alfa", "zeta"],
  );
});

test("«Pendiente de ti» es el grupo pending de attentionGroup, con lo que te espera primero", () => {
  const tasks = TASK_STATES.map((state, i) => row(i + 1, state));
  const { pending } = buildProjects(tasks, false);
  assert.deepEqual(
    pending.map((t) => t.state),
    ["plan_review", "review", "failed", "draft"],
  );
});

test("sin tareas no hay proyectos ni pendientes", () => {
  assert.deepEqual(buildProjects([], false), { projects: [], pending: [], partial: false });
});

test("un estado que esta versión no conoce no cuenta como que te espera ni lanza", () => {
  const { projects, pending } = buildProjects([row(1, "teleported")], false);
  assert.deepEqual(projects[0]?.counts, { waiting: 0, active: 0, drafts: 0, closed: 1 });
  assert.deepEqual(pending, []);
});

test("con la lista truncada los contadores se marcan como parciales", () => {
  assert.equal(buildProjects([row(1, "draft")], true).partial, true);
  assert.equal(buildProjects([row(1, "draft")], false).partial, false);
});

test("el aviso de truncado dice que son las más antiguas, que es lo que devuelve el daemon", () => {
  const html = renderToStaticMarkup(
    createElement(TaskList, { tasks: [row(1, "draft")], truncated: true }),
  );
  assert.match(html, /200 más antiguas/);
  assert.doesNotMatch(html, /recientes/);
});
