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

const SRC = import.meta.dirname;
const css = readFileSync(join(SRC, "app.css"), "utf8");
const app = readFileSync(join(SRC, "App.tsx"), "utf8");

const task: TaskRow = {
  number: 1,
  title: "tarea 1",
  titleErased: false,
  state: "draft" as TaskState,
  repo: "o/togi",
  baseBranch: "main",
  hasCriteria: true,
  updatedAt: "2026-11-07T10:00:00Z",
  version: 1,
};
const render = (data: ReturnType<typeof buildProjects> | null) =>
  renderToStaticMarkup(
    createElement(ProjectColumn, {
      data,
      view: PENDING,
      closed: new Set<string>(),
      onView: () => {},
      onToggle: () => {},
      head: createElement("b", { id: "marca" }, "MARCA"),
      foot: createElement("p", { id: "estado", role: "status" }, "DAEMON"),
    }),
  );

test("la marca va arriba de la columna y el estado del daemon abajo, con la lista en medio", () => {
  const html = render(buildProjects([task], false));
  const [marca, lista, estado] = [
    html.indexOf("MARCA"),
    html.indexOf("Pendiente de ti"),
    html.indexOf("DAEMON"),
  ];
  assert.ok(marca > -1 && marca < lista && lista < estado, html);
  assert.match(html, /class="col-head"[^>]*><b id="marca"/);
  assert.match(html, /class="col-foot"[^>]*><p id="estado" role="status"/);
});

test("sin lista (el daemon no responde) siguen la marca y el estado, y no hay datos de tareas", () => {
  const html = render(null);
  assert.match(html, /MARCA/);
  assert.match(html, /DAEMON/);
  assert.doesNotMatch(html, /Pendiente de ti|col-project/);
});

test("sin cabecera ni pie la columna es la de antes", () => {
  const html = renderToStaticMarkup(
    createElement(ProjectColumn, {
      data: buildProjects([task], false),
      view: PENDING,
      closed: new Set<string>(),
      onView: () => {},
      onToggle: () => {},
    }),
  );
  assert.doesNotMatch(html, /col-head|col-foot/);
});

test("la lista se desplaza dentro de la columna y el pie queda abajo", () => {
  assert.match(css, /\n\.project-col \{[^}]*display: flex[^}]*flex-direction: column/);
  assert.match(css, /\n\.col-scroll \{[^}]*flex: 1[^}]*overflow-y: auto/);
  assert.match(css, /\n\.col-foot \{[^}]*font: 400 11\.5px[^}]*var\(--font-mono\)/);
});

test("la marca y el estado del daemon van en la columna, no en el centro", () => {
  assert.match(app, /<ProjectColumn[\s\S]*head=\{/);
  assert.match(app, /<ProjectColumn[\s\S]*foot=\{/);
  const main = app.slice(app.indexOf("<main"), app.indexOf("</main>"));
  assert.doesNotMatch(main, /Monogram|role="status"|className="logo"/);
});

test("la columna se monta siempre, para que el estado del daemon no desaparezca si se cae", () => {
  assert.doesNotMatch(app, /projects !== null && \(\s*<ProjectColumn/);
});
