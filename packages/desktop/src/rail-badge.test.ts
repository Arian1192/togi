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

/** Todas las declaraciones de las reglas cuyo selector (de una lista) es exactamente `selector`. */
const declarations = (selector: string): string =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .map((chunk) => chunk.split("{"))
    .filter(
      ([sel, body]) => body !== undefined && sel?.split(",").some((s) => s.trim() === selector),
    )
    .map(([, body]) => body)
    .join(";");

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
const render = (collapsed: boolean) =>
  renderToStaticMarkup(
    createElement(ProjectColumn, {
      data: buildProjects(TASKS, false),
      view: PENDING,
      closed: new Set<string>(),
      onView: () => {},
      onToggle: () => {},
      collapsed,
    }),
  );
const button = (html: string, title: string): string => {
  const start = html.indexOf(`title="${title}`);
  assert.notEqual(start, -1, title);
  return html.slice(start, html.indexOf("</button>", start));
};

test("lo que te espera es una insignia con solo el número: el color ya dice que te espera", () => {
  for (const collapsed of [false, true]) {
    const togi = button(render(collapsed), "togi · 2 esperan");
    assert.match(
      togi,
      /class="rail-badge tone-human"[^>]*aria-hidden="true"><span class="rail-badge-body">2<\/span>/,
    );
  }
});

test("un proyecto sin nada que te espere no lleva insignia", () => {
  assert.doesNotMatch(button(render(true), "promos"), /rail-badge/);
});

test("«Pendiente de ti» lleva el número de tareas en su insignia", () => {
  const pending = button(render(true), "Pendiente de ti");
  assert.match(pending, /class="rail-badge[^"]*"[^>]*><span class="rail-badge-body">3<\/span>/);
});

test("el icono y la insignia están siempre en el DOM y solo se ven plegada: opacidad, no cambio de contenido", () => {
  for (const sel of [".col-initial", ".rail-badge"]) {
    assert.match(declarations(sel), /opacity: 0/, `${sel} desplegada`);
    assert.match(declarations(`.is-collapsed ${sel}`), /opacity: 1/, `${sel} plegada`);
    assert.match(declarations(sel), /pointer-events: none/, sel);
  }
});

test("el icono ocupa todo el botón y va centrado, así que todas las iniciales se alinean", () => {
  const icon = declarations(".col-initial");
  assert.match(icon, /position: absolute/);
  assert.match(icon, /inset: 0/);
  assert.match(icon, /place-items: center/);
  assert.match(declarations(".col-name"), /position: relative/);
  assert.match(declarations(".col-pending"), /position: relative/);
});

test("la insignia cuelga de la esquina del icono (el centro del botón) y crece hacia fuera, sin taparlo", () => {
  const badge = declarations(".rail-badge");
  assert.match(badge, /position: absolute/);
  assert.match(badge, /left: calc\(50% \+ 3px\)/);
  assert.match(badge, /bottom: calc\(50% \+ 2px\)/);
  assert.doesNotMatch(badge, /right: 0/);
  assert.match(badge, /background: currentColor/);
  assert.match(declarations(".rail-badge-body"), /color: var\(--bg\)/);
});
