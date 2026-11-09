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

test("desplegada, la cabecera lleva un botón para plegar con su atajo", () => {
  const { html } = column(false);
  assert.match(
    html,
    /aria-label="Plegar la columna"[^>]*aria-expanded="true"|aria-expanded="true"[^>]*aria-label="Plegar la columna"/,
  );
  assert.match(html, /⌘\\/);
  assert.doesNotMatch(html, /is-rail/);
});

test("plegada, es un riel: sin tareas ni nombres largos, con la inicial de cada proyecto", () => {
  const { html } = column(true);
  assert.match(html, /project-col is-rail/);
  assert.doesNotMatch(html, /tarea 1|Pendiente de ti</);
  for (const initial of ["t", "p"]) {
    assert.match(html, new RegExp(`class="rail-initial"[^>]*>${initial}<`, "i"));
  }
  assert.match(html, /aria-label="Desplegar la columna"/);
});

test("en el riel cada proyecto sigue siendo un botón con su nombre completo para un lector de pantalla", () => {
  const { html } = column(true);
  assert.match(html, /aria-label="togi"/);
  assert.match(html, /aria-label="promos"/);
});

test("en el riel solo el proyecto con algo que te espera lleva el ◆", () => {
  const { html } = column(true);
  const togi = html.slice(html.indexOf('aria-label="togi"'), html.indexOf('aria-label="promos"'));
  assert.match(togi, /tone-human/);
  const promos = html.slice(html.indexOf('aria-label="promos"'));
  assert.doesNotMatch(promos.slice(0, promos.indexOf("</button>")), /tone-human/);
});

test("el riel conserva lo seleccionado y los botones avisan de lo que se pulsa", () => {
  const { props, calls, html } = column(true, { kind: "project", repo: "o/promos" });
  assert.equal((html.match(/aria-current="true"/g) ?? []).length, 1);
  const buttons = find(ProjectColumn(props), (el) => el.type === "button");
  const click = (label: string) => {
    const found = buttons.find((b) => b.props["aria-label"] === label);
    assert.ok(found, label);
    (found.props.onClick as () => void)();
  };
  click("togi");
  click("Desplegar la columna");
  assert.deepEqual(calls.views, [{ kind: "project", repo: "o/togi" }]);
  assert.equal(calls.collapse, 1);
});

test("plegada no enseña el pie (el estado del daemon), que no cabe en 56 px", () => {
  assert.doesNotMatch(column(true).html, /DAEMON/);
  assert.match(column(false).html, /DAEMON/);
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

test("el riel mide 56 px y lleva los botones a 32 px como el resto", () => {
  assert.match(css, /\.project-col\.is-rail \{[^}]*width: 56px/);
  assert.match(css, /\.rail-project[^{]*\{[^}]*min-height: 32px/);
});

test("App pliega con el botón y con ⌘\\, y despliega sola si no hay lista para que el estado se vea", () => {
  assert.match(app, /isToggleShortcut/);
  assert.match(app, /addEventListener\("keydown"/);
  assert.match(app, /removeEventListener\("keydown"/);
  assert.match(app, /collapsed=\{collapsed && projects !== null\}/);
});
