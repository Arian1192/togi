import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { STATE_BRAND, type TaskState } from "@togi/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GLYPHS, StateGlyph } from "./StateGlyph.ts";

const states = Object.keys(STATE_BRAND) as TaskState[];
const svgOf = (state: TaskState) => renderToStaticMarkup(createElement(StateGlyph, { state }));
const used = [...new Set(Object.values(STATE_BRAND).map((b) => b.glyph))];
// Un estado que usa cada glifo, para dibujarlo por su carácter.
const svg = (glyph: string) => svgOf(states.find((s) => STATE_BRAND[s].glyph === glyph) ?? "draft");

test("hay un SVG para cada glifo de la tabla de estados y ninguno de más", () => {
  assert.deepEqual([...used].sort(), Object.keys(GLYPHS).sort());
  assert.equal(used.length, 7); // ○ ◐ ◑ ◆ ● ✕ —
});

test("cada estado dibuja el glifo que le da STATE_BRAND", () => {
  assert.equal(states.length, 9);
  for (const state of states) {
    assert.equal(svgOf(state), svg(STATE_BRAND[state].glyph), state);
  }
  // planning y building comparten ◐, y plan_review y review comparten ◆.
  assert.equal(svgOf("planning"), svgOf("building"));
  assert.equal(svgOf("plan_review"), svgOf("review"));
  assert.notEqual(svgOf("planning"), svgOf("verifying"));
});

test("cada glifo es un SVG en línea de trazo 1,5, esquinas rectas y currentColor", () => {
  for (const glyph of used) {
    const markup = svg(glyph);
    assert.match(markup, /^<svg /, glyph);
    for (const attr of [
      'viewBox="0 0 16 16"',
      'stroke="currentColor"',
      'stroke-width="1.5"',
      'stroke-linejoin="miter"',
      'stroke-linecap="butt"',
      'aria-hidden="true"',
    ]) {
      assert.ok(markup.includes(attr), `${glyph} sin ${attr}`);
    }
  }
});

test("no usa colores, texto ni fuentes: todo sale de currentColor", () => {
  for (const glyph of used) {
    const markup = svg(glyph);
    assert.doesNotMatch(markup, /#[0-9a-f]{3,8}\b|rgb|<text|font|<image|<use/i, glyph);
    const fills = [...markup.matchAll(/fill="([^"]*)"/g)].map((m) => m[1]);
    for (const fill of fills) assert.ok(["none", "currentColor"].includes(fill ?? ""), glyph);
  }
});

test("rellenos y vacíos: ○ y ✕ y — sin relleno; ◆ y ● rellenos; ◐ y ◑ con medio círculo", () => {
  const filled = (glyph: string) => (svg(glyph).match(/fill="currentColor"/g) ?? []).length;
  for (const glyph of ["○", "✕", "—"]) assert.equal(filled(glyph), 0, glyph);
  for (const glyph of ["◆", "●", "◐", "◑"]) assert.equal(filled(glyph), 1, glyph);
});

test("◐ rellena el lado izquierdo y ◑ el derecho", () => {
  // Arco de arriba (8 2.75) a abajo (8 13.25): sweep 0 es antihorario, o sea, por la izquierda.
  assert.match(svgOf("planning"), /d="M8 2\.75A5\.25 5\.25 0 0 0 8 13\.25Z"/);
  assert.match(svgOf("verifying"), /d="M8 2\.75A5\.25 5\.25 0 0 1 8 13\.25Z"/);
});

test("el manual de marca dice dónde se dibuja cada glifo", () => {
  const manual = readFileSync(
    join(import.meta.dirname, "..", "..", "..", "docs", "marca", "manual-de-marca.md"),
    "utf8",
  );
  assert.match(manual, /interfaces gráficas .* los glifos se dibujan como SVG en línea/);
  assert.match(manual, /trazo de 1,5 px, esquinas rectas y `currentColor`/);
  assert.match(manual, /En la terminal son los caracteres de la tabla/);
});

test("los siete glifos son distintos y un estado desconocido no dibuja nada", () => {
  assert.equal(new Set(used.map(svg)).size, 7);
  assert.equal(svgOf("otro" as TaskState), "");
});
