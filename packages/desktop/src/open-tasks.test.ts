import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskState } from "@togi/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectColumn } from "./ProjectColumn.ts";
import { buildProjects, openTasks } from "./projects.ts";
import type { TaskRow } from "./TaskList.ts";
import { PENDING } from "./viewState.ts";

const row = (number: number, state: string): TaskRow => ({
  number,
  title: `tarea ${number}`,
  titleErased: false,
  state: state as TaskState,
  repo: "o/togi",
  baseBranch: "main",
  hasCriteria: true,
  updatedAt: "2026-11-07T10:00:00Z",
  version: 1,
});
const MIXED = [
  row(1, "merged"),
  row(2, "draft"),
  row(3, "building"),
  row(4, "plan_review"),
  row(5, "rejected"),
  row(6, "failed"),
  row(7, "planning"),
  row(8, "teleported"),
];
const project = () => {
  const found = buildProjects(MIXED, false).projects[0];
  assert.ok(found);
  return found;
};

test("la columna no lista las tareas cerradas, que son un contador del proyecto", () => {
  assert.deepEqual(
    openTasks(project()).map((t) => t.number),
    [4, 6, 3, 7, 2],
  );
});

test("primero lo que te espera, después lo en curso y al final los borradores, cada tramo por número", () => {
  const states = openTasks(project()).map((t) => t.state);
  assert.deepEqual(states, ["plan_review", "failed", "building", "planning", "draft"]);
});

test("un estado que esta versión no conoce no sale en la columna", () => {
  assert.ok(!openTasks(project()).some((t) => t.number === 8));
});

test("la columna pinta solo las abiertas y en ese orden", () => {
  const html = renderToStaticMarkup(
    createElement(ProjectColumn, {
      data: buildProjects(MIXED, false),
      view: PENDING,
      closed: new Set<string>(),
      onView: () => {},
      onToggle: () => {},
    }),
  );
  const order = [4, 6, 3, 7, 2].map((n) => html.indexOf(`#${n}<`));
  assert.ok(
    order.every((i) => i > -1),
    "falta una tarea abierta",
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  );
  for (const n of [1, 5, 8]) assert.ok(!html.includes(`#${n}<`), `#${n} no debería salir`);
});
