import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskList, type TaskRow } from "./TaskList.ts";

const row = (number: number, state: TaskRow["state"]): TaskRow => ({
  number,
  title: `tarea ${number}`,
  titleErased: false,
  state,
  hasCriteria: true,
  updatedAt: "2026-11-07T10:00:00Z",
  version: 1,
});
const tasks = [row(1, "plan_review"), row(2, "building"), row(3, "plan_review")];
const html = (onOpen?: (n: number) => void) =>
  renderToStaticMarkup(createElement(TaskList, { tasks, truncated: false, onOpen }));
const count = (out: string) => (out.match(/Revisar el plan/g) ?? []).length;

test("solo las tareas con el plan en revisión ofrecen revisarlo", () => {
  assert.equal(count(html(() => {})), 2);
});

test("sin onOpen la lista no pinta ningún botón", () => {
  assert.equal(count(html()), 0);
  assert.doesNotMatch(html(), /<button/);
});
