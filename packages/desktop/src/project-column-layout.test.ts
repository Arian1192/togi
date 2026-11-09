import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const css = readFileSync(join(import.meta.dirname, "app.css"), "utf8");

/** El cuerpo de la regla cuyo selector es exactamente `selector`. */
const rule = (selector: string): string => {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `falta la regla ${selector}`);
  return css.slice(start, css.indexOf("}", start));
};

test("la columna ocupa el alto de la ventana y se desplaza sola, sin arrastrar el centro", () => {
  const col = rule(".project-col");
  assert.match(col, /position: sticky/);
  assert.match(col, /top: 0/);
  assert.match(col, /height: 100vh/);
  assert.match(col, /overflow-y: auto/);
  assert.match(col, /overflow-x: hidden/);
});

test("las filas ocupan todo el ancho de la columna para que los títulos largos se recorten", () => {
  for (const sel of [".col-pending", ".col-name", ".col-task"]) {
    assert.match(css, new RegExp(`${sel.replace(".", "\\.")}[^{]*\\{[^}]*width: 100%`), sel);
  }
  assert.match(css, /\.col-task,[^{]*\{[^}]*box-sizing: border-box/);
  const li = rule(".col-tasks li");
  assert.match(li, /min-width: 0/);
});

test("el título se recorta con puntos suspensivos en una sola línea", () => {
  const title = rule(".col-title");
  assert.match(title, /overflow: hidden/);
  assert.match(title, /text-overflow: ellipsis/);
  assert.match(title, /white-space: nowrap/);
});
