import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TaskState } from "@togi/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectColumn } from "./ProjectColumn.ts";
import { buildProjects } from "./projects.ts";
import type { TaskRow } from "./TaskList.ts";
import { PENDING } from "./viewState.ts";

const css = readFileSync(join(import.meta.dirname, "app.css"), "utf8");

const row = (number: number, state: string, repo: string): TaskRow => ({
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
  row(1, "plan_review", "o/togi"),
  row(2, "review", "o/togi"),
  row(3, "draft", "o/togi"),
  row(4, "building", "o/promos"),
];
const html = renderToStaticMarkup(
  createElement(ProjectColumn, {
    data: buildProjects(TASKS, false),
    view: PENDING,
    closed: new Set<string>(),
    onView: () => {},
    onToggle: () => {},
    collapsed: true,
  }),
);
const button = (label: string): string => {
  const start = html.indexOf(`aria-label="${label}`);
  assert.notEqual(start, -1, label);
  return html.slice(start, html.indexOf("</button>", start));
};

test("en el riel lo que te espera es una insignia con el ◆ y el número, sobre la letra", () => {
  const togi = button("togi");
  assert.match(
    togi,
    /class="rail-badge tone-human"[^>]*aria-hidden="true"><span class="rail-badge-body"><svg[^>]*class="glyph"[^>]*>.*<\/svg>2<\/span>/,
  );
});

test("la inicial va sola y centrada: la insignia no la desplaza, así que todas se alinean", () => {
  for (const label of ["togi", "promos"]) {
    const b = button(label);
    assert.match(b, /^[^>]*>\s*<span class="rail-initial">[A-Z]<\/span>/, label);
  }
});

test("un proyecto sin nada que te espere no lleva insignia", () => {
  assert.doesNotMatch(button("promos"), /rail-badge/);
});

test("«Pendiente de ti» lleva su ◆ con el número de tareas como insignia", () => {
  const pending = button("Pendiente de ti");
  assert.match(pending, /class="rail-badge[^"]*"[^>]*><span class="rail-badge-body">3<\/span>/);
  assert.match(pending, /class="glyph"/);
});

test("el nombre accesible no cambia y el título dice cuántas esperan", () => {
  assert.match(html, /aria-label="togi"/);
  assert.match(html, /title="togi · 2 esperan"/);
});

test("la insignia va pegada a la esquina de la letra, sobre ella", () => {
  assert.match(css, /\.rail-project \{[^}]*position: relative/);
  assert.match(css, /\.rail-badge \{[^}]*position: absolute[^}]*top: 0[^}]*right: 0/);
  assert.match(css, /\.rail-badge \{[^}]*background: currentColor/);
  assert.match(css, /\.rail-badge-body \{[^}]*color: var\(--bg\)/);
});
