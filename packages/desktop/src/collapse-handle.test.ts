import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TaskState } from "@togi/core";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectColumn } from "./ProjectColumn.ts";
import { buildProjects } from "./projects.ts";
import type { TaskRow } from "./TaskList.ts";
import { PENDING } from "./viewState.ts";

const css = readFileSync(join(import.meta.dirname, "app.css"), "utf8");
const rule = (selector: string): string => {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `falta la regla ${selector}`);
  return css.slice(start, css.indexOf("}", start));
};

const task: TaskRow = {
  number: 1,
  title: "tarea",
  titleErased: false,
  state: "draft" as TaskState,
  repo: "o/togi",
  baseBranch: "main",
  hasCriteria: true,
  updatedAt: "2026-11-07T10:00:00Z",
  version: 1,
};
const props = (collapsed: boolean, onCollapse: (() => void) | null = () => {}) => ({
  data: buildProjects([task], false),
  view: PENDING,
  closed: new Set<string>(),
  onView: () => {},
  onToggle: () => {},
  collapsed,
  ...(onCollapse === null ? {} : { onCollapse }),
  head: createElement("b", null, "MARCA"),
});
const html = (collapsed: boolean, onCollapse: (() => void) | null = () => {}) =>
  renderToStaticMarkup(createElement(ProjectColumn, props(collapsed, onCollapse)));

type El = { type: unknown; props: Record<string, unknown> };
function find(node: ReactNode, test: (el: El) => boolean): El[] {
  if (Array.isArray(node)) return node.flatMap((n) => find(n, test));
  if (!isValidElement(node)) return [];
  const el = node as unknown as El;
  return [...(test(el) ? [el] : []), ...find(el.props.children as ReactNode, test)];
}

test("el control de plegar va sobre la línea que separa la columna del centro, no dentro de la cabecera", () => {
  const out = html(false);
  assert.ok(
    out.indexOf("</nav>") < out.indexOf('class="col-handle"'),
    "debe ir fuera de la columna",
  );
  const nav = out.slice(0, out.indexOf("</nav>"));
  assert.doesNotMatch(nav, /Plegar la columna|col-handle/);
});

test("ya no hay botón con borde redondeado dentro de la columna", () => {
  assert.doesNotMatch(html(false), /col-collapse/);
  assert.doesNotMatch(css, /\.col-collapse/);
});

test("conserva el nombre accesible, el estado y el atajo", () => {
  const open = html(false);
  assert.match(open, /<button[^>]*aria-label="Plegar la columna"[^>]*>/);
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /title="Plegar la columna \(⌘\\\)"/);
  const closed = html(true);
  assert.match(closed, /<button[^>]*aria-label="Desplegar la columna"[^>]*>/);
  assert.match(closed, /aria-expanded="false"/);
});

test("el icono es el chevron de Lucide: < para plegar y > para desplegar, con el trazo de la marca", () => {
  const open = html(false);
  assert.match(open, /<path d="m15 18-6-6 6-6"/);
  const closed = html(true);
  assert.match(closed, /<path d="m9 18 6-6-6-6"/);
  assert.match(open, /stroke-width="1.5"/);
  assert.match(open, /<svg[^>]*aria-hidden="true"/);
});

test("sin onCollapse no hay control", () => {
  assert.doesNotMatch(html(false, null), /col-handle/);
});

test("el control avisa al pulsarlo", () => {
  let calls = 0;
  const tree = ProjectColumn(props(false, () => calls++));
  const button = find(
    tree,
    (el) => el.type === "button" && el.props["aria-label"] === "Plegar la columna",
  )[0];
  assert.ok(button);
  (button.props.onClick as () => void)();
  assert.equal(calls, 1);
});

test("el asa mide 0 de ancho y se pega al borde de la columna, así que acompaña su transición", () => {
  const handle = rule(".col-handle");
  assert.match(handle, /width: 0/);
  assert.match(handle, /position: sticky/);
  assert.match(handle, /height: 100vh/);
});

test("la pestaña es fina, sin forma de botón redondo, y cabalga sobre la línea", () => {
  const tab = rule(".col-handle-btn");
  assert.match(tab, /position: absolute/);
  assert.match(tab, /left: 0/);
  assert.match(tab, /translateX\(-50%\)/);
  assert.match(tab, /width: 14px/);
  assert.match(tab, /border-radius: [0-4]px/);
  assert.doesNotMatch(tab, /border-radius: (?:[5-9]|[1-9][0-9]+)px|border-radius: 50%/);
});

test("el foco y el hover se ven con los tokens", () => {
  assert.match(css, /\.col-handle-btn:hover[^{]*\{[^}]*color: var\(--ink\)/);
  assert.match(css, /\.col-handle-btn:focus-visible[^{]*\{[^}]*outline: 2px solid var\(--ink\)/);
});

test("el contenido ya no cambia a mitad de la animación, así que no hay fundidos para disimularlo", () => {
  assert.doesNotMatch(css, /@keyframes col-fade-in|animation: col-fade-in/);
});
