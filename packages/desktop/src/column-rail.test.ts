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
import { isToggleShortcut, PENDING, type View } from "./viewState.ts";

// La columna plegada es la MISMA columna (un solo DOM, como el Sidebar de shadcn): el contenido no
// cambia entre un estado y otro, solo el CSS lo recorta, lo desvanece o lo coloca. Por eso la
// transición es continua. Aquí se vigila el contenido y el cableado; las medidas, en column-transition.

const SRC = import.meta.dirname;
const css = readFileSync(join(SRC, "app.css"), "utf8");
const app = readFileSync(join(SRC, "App.tsx"), "utf8");

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
  row(2, "building", "o/togi"),
  row(3, "building", "o/promos"),
];

interface Calls {
  views: View[];
  collapse: number;
}
const column = (collapsed: boolean, view: View = PENDING) => {
  const calls: Calls = { views: [], collapse: 0 };
  const props = {
    data: buildProjects(TASKS, false),
    view,
    closed: new Set<string>(),
    onView: (v: View) => calls.views.push(v),
    onToggle: () => {},
    collapsed,
    onCollapse: () => {
      calls.collapse += 1;
    },
    head: createElement("b", null, "MARCA"),
    foot: createElement("p", null, "DAEMON"),
  };
  return { props, calls, html: renderToStaticMarkup(createElement(ProjectColumn, props)) };
};

/** Recorre el árbol de elementos que devuelve el componente y reúne los que cumplen `test`. */
type El = { type: unknown; props: Record<string, unknown> };
function find(node: ReactNode, test: (el: El) => boolean): El[] {
  if (Array.isArray(node)) return node.flatMap((n) => find(n, test));
  if (!isValidElement(node)) return [];
  const el = node as unknown as El;
  return [...(test(el) ? [el] : []), ...find(el.props.children as ReactNode, test)];
}

test("desplegada lleva el asa para plegar con su atajo, y plegada, para desplegar", () => {
  const open = column(false).html;
  assert.match(open, /aria-label="Plegar la columna"/);
  assert.match(open, /⌘\\/);
  assert.match(open, /<nav class="project-col"/);
  const closed = column(true).html;
  assert.match(closed, /<nav class="project-col is-collapsed"/);
  assert.match(closed, /aria-label="Desplegar la columna"/);
});

test("plegada es la misma columna: el contenido no cambia, solo lo recorta el CSS", () => {
  const open = column(false).html;
  const closed = column(true).html;
  for (const text of [
    "MARCA",
    "DAEMON",
    "Pendiente de ti",
    "togi",
    "promos",
    "tarea 1",
    "tarea 3",
  ]) {
    assert.ok(open.includes(text), `desplegada: falta ${text}`);
    assert.ok(closed.includes(text), `plegada: falta ${text}`);
  }
  const buttons = (html: string) => (html.match(/<button/g) ?? []).length;
  assert.equal(buttons(open), buttons(closed));
});

test("cada proyecto lleva su inicial como icono, decorativo, y el nombre sigue siendo el accesible", () => {
  const { html } = column(true);
  for (const initial of ["T", "P"]) {
    assert.match(html, new RegExp(`class="col-initial"[^>]*aria-hidden="true">${initial}<`));
  }
  assert.match(html, /title="togi · 1 esperan"/);
  assert.match(html, /<span class="col-label">togi<\/span>/);
});

test("«Pendiente de ti» lleva su ◆ como icono, decorativo, y su etiqueta sigue ahí", () => {
  const { html } = column(true);
  assert.match(html, /<span class="col-label">Pendiente de ti<\/span>/);
  assert.match(
    html,
    /class="col-initial tone-human"[^>]*aria-hidden="true"><svg[^>]*class="glyph"/,
  );
});

test("plegada conserva lo seleccionado y los botones avisan de lo que se pulsa", () => {
  const { props, calls, html } = column(true, { kind: "project", repo: "o/promos" });
  assert.equal((html.match(/aria-current="true"/g) ?? []).length, 1);
  const buttons = find(ProjectColumn(props), (el) => el.type === "button");
  const click = (match: (b: El) => boolean) => {
    const found = buttons.find(match);
    assert.ok(found);
    (found.props.onClick as () => void)();
  };
  click((b) => b.props.title === "togi · 1 esperan");
  click((b) => b.props["aria-label"] === "Desplegar la columna");
  assert.deepEqual(calls.views, [{ kind: "project", repo: "o/togi" }]);
  assert.equal(calls.collapse, 1);
});

test("⌘\\ es el atajo y nada más lo dispara", () => {
  const key = (over: Partial<Parameters<typeof isToggleShortcut>[0]>) =>
    isToggleShortcut({
      key: "\\",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...over,
    });
  assert.equal(key({}), true);
  assert.equal(key({ metaKey: false }), false);
  assert.equal(key({ shiftKey: true }), false);
  assert.equal(key({ altKey: true }), false);
  assert.equal(key({ ctrlKey: true }), false);
  assert.equal(key({ key: "k" }), false);
});

test("plegada mide 56 px y los botones siguen a 32 px como el resto", () => {
  assert.match(css, /\.project-col\.is-collapsed \{[^}]*width: 56px/);
  assert.match(css, /\.col-pending,[^{]*\.col-name[^{]*\{[^}]*min-height: 32px/);
});

test("App pliega con el asa y con ⌘\\, y despliega sola si no hay lista para que el estado se vea", () => {
  assert.match(app, /isToggleShortcut/);
  assert.match(app, /addEventListener\("keydown"/);
  assert.match(app, /removeEventListener\("keydown"/);
  assert.match(app, /collapsed=\{collapsed && projects !== null\}/);
});
