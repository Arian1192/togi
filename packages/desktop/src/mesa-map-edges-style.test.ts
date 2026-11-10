import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// El estilo del mapa sobre React Flow (4c-6): su hueco, su retícula, sus aristas y sus botones, solo
// con los tokens de la marca.
const css = readFileSync(join(import.meta.dirname, "app.css"), "utf8");
const block = css.slice(
  css.indexOf("/* El mapa sobre React Flow: su hueco"),
  css.indexOf("/* Los nodos del mapa sobre React Flow"),
);

test("el mapa usa los tokens de la marca: ningún color escrito a mano", () => {
  assert.ok(block.length > 0, "falta el bloque del mapa");
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
});

test("el mapa tiene altura, que React Flow necesita, y una retícula que se ve", () => {
  assert.match(block, /\.mesa-map \{[^}]*min-height: 420px/);
  assert.match(block, /--xy-background-pattern-color: color-mix\(in srgb, var\(--border\)/);
});

test("tu arista va en human; las de plazas en curso, en agent; las terminadas, a trazos", () => {
  assert.match(block, /\.is-you > \.mesa-edge \{[^}]*stroke: var\(--human\)/);
  assert.match(block, /\.is-active > \.mesa-edge,[^{]*\{[^}]*stroke: var\(--agent\)/);
  assert.match(block, /\.is-done > \.mesa-edge \{[^}]*stroke-dasharray: 4 4/);
});

test("el punto recorre su arista sin parar y, sin movimiento, se queda quieto", () => {
  assert.match(block, /\.mesa-dot \{[^}]*animation: mesa-flow 2\.4s linear infinite/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{[^@]*\.mesa-dot \{[^}]*animation: none/);
});
