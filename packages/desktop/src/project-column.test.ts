import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SRC = import.meta.dirname;
const css = readFileSync(join(SRC, "app.css"), "utf8");
const app = readFileSync(join(SRC, "App.tsx"), "utf8");

/** El cuerpo de la primera regla cuyo selector es exactamente `selector`. */
const rule = (selector: string): string => {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `falta la regla ${selector}`);
  return css.slice(start, css.indexOf("}", start));
};

test("la columna de proyectos mide 288 px (ADR-010 §2 y manual de marca)", () => {
  assert.match(rule(".project-col"), /width: 288px/);
});

test("todo lo que se pulsa en la columna tiene filas de 32 px", () => {
  const shared = css.slice(
    css.indexOf(".col-pending,"),
    css.indexOf("{", css.indexOf(".col-toggle {")),
  );
  for (const sel of [".col-pending", ".col-name", ".col-task", ".col-toggle"]) {
    assert.ok(shared.includes(sel), sel);
  }
  assert.match(css, /\.col-toggle \{[^}]*min-height: 32px/);
});

test("la selección y el foco se ven con los tokens, no con colores propios", () => {
  assert.match(css, /\.col-task\[aria-current="true"\] \{\s*background: var\(--border\)/);
  assert.match(css, /\.col-task:focus-visible[^{]*\{[^}]*outline: 2px solid var\(--ink\)/);
});

test("App monta la columna solo con la lista cargada y filtra lo que muestra por la vista", () => {
  assert.match(app, /projects !== null && \(\s*<ProjectColumn/);
  assert.match(app, /tasksFor\(view, list\.tasks\)/);
});
