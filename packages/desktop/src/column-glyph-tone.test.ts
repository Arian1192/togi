import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskState } from "@togi/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectColumn } from "./ProjectColumn.ts";
import { buildProjects } from "./projects.ts";
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

const html = renderToStaticMarkup(
  createElement(ProjectColumn, {
    data: buildProjects([row(1, "plan_review"), row(2, "building"), row(3, "draft")], false),
    view: PENDING,
    closed: new Set<string>(),
    onView: () => {},
    onToggle: () => {},
  }),
);

/** El glifo de la fila de la tarea `n` va dentro de un elemento con la clase de color de su estado. */
const toneOf = (n: number): string | undefined =>
  new RegExp(
    `<span class="tone-([a-z-]+)"><svg[^>]*class="glyph"[^>]*>(?:(?!</button>).)*#${n}<`,
  ).exec(html)?.[1];

test("el glifo de cada tarea de la columna lleva el color de su estado, como en la lista", () => {
  assert.equal(toneOf(1), "human");
  assert.equal(toneOf(2), "agent");
  assert.equal(toneOf(3), "ink-muted");
});
