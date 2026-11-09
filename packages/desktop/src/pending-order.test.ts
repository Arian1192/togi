import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskState } from "@togi/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskList, type TaskRow } from "./TaskList.ts";
import { PENDING, tasksFor } from "./viewState.ts";

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
const TASKS = [row(1, "draft"), row(2, "plan_review"), row(3, "draft"), row(4, "failed")];

test("«Pendiente de ti» muestra primero lo que te espera y después los borradores", () => {
  assert.deepEqual(
    tasksFor(PENDING, TASKS).map((t) => t.number),
    [2, 4, 1, 3],
  );
});

test("la lista del centro respeta ese orden dentro del grupo", () => {
  const html = renderToStaticMarkup(
    createElement(TaskList, { tasks: tasksFor(PENDING, TASKS), truncated: false }),
  );
  const at = (n: number) => html.indexOf(`#${n}<`);
  assert.ok(at(2) < at(4) && at(4) < at(1) && at(1) < at(3));
});
