import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskState } from "@togi/core";
import type { TaskRow } from "./TaskList.ts";
import { PENDING, tasksFor, toggled } from "./viewState.ts";

const row = (number: number, state: string, repo = "o/togi"): TaskRow => ({
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
const tasks = [
  row(1, "plan_review"),
  row(2, "building"),
  row(3, "draft", "o/promos"),
  row(4, "merged"),
];
const numbers = (list: TaskRow[]) => list.map((t) => t.number);

test("se empieza en «Pendiente de ti»", () => {
  assert.deepEqual(PENDING, { kind: "pending" });
});

test("«Pendiente de ti» muestra solo el grupo pending de todos los proyectos", () => {
  assert.deepEqual(numbers(tasksFor(PENDING, tasks)), [1, 3]);
});

test("un proyecto muestra todas sus tareas y una tarea, solo ella", () => {
  assert.deepEqual(numbers(tasksFor({ kind: "project", repo: "o/togi" }, tasks)), [1, 2, 4]);
  assert.deepEqual(numbers(tasksFor({ kind: "task", number: 3 }, tasks)), [3]);
});

test("una selección que ya no existe no muestra nada", () => {
  assert.deepEqual(tasksFor({ kind: "task", number: 99 }, tasks), []);
  assert.deepEqual(tasksFor({ kind: "project", repo: "o/otro" }, tasks), []);
});

test("plegar y desplegar un proyecto no toca el conjunto anterior", () => {
  const empty: ReadonlySet<string> = new Set();
  const closed = toggled(empty, "o/togi");
  assert.deepEqual([...closed], ["o/togi"]);
  assert.deepEqual([...empty], []);
  assert.deepEqual([...toggled(closed, "o/togi")], []);
});
