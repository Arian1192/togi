import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// El estilo de los pasos y la línea de tiempo del lateral por tarea (4d-4), solo con tokens.
const css = readFileSync(join(import.meta.dirname, "app.css"), "utf8");
const block = css.slice(
  css.indexOf("/* Los pasos: puntos"),
  css.indexOf("/* El mapa sobre React Flow"),
);

test("los pasos y la línea de tiempo usan los tokens de la marca: ningún color escrito a mano", () => {
  assert.ok(block.length > 0, "falta el bloque de los pasos");
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
});

test("el paso actual late en agent; el tuyo y el fallido, en human; lo hecho, en ink", () => {
  assert.match(
    block,
    /\.is-now \.mesa-step-dot \{[^}]*background: var\(--agent\);[^}]*animation: mesa-beat/,
  );
  assert.match(
    block,
    /\.is-you \.mesa-step-dot,\s*\.mesa-steps \.is-failed \.mesa-step-dot \{[^}]*var\(--human\)/,
  );
  assert.match(block, /\.is-done \.mesa-step-dot \{[^}]*background: var\(--ink\)/);
  assert.match(block, /\.mesa-step\.is-done \+ \.mesa-step::before \{[^}]*var\(--ink\)/);
});

test("sin movimiento, el paso actual no late", () => {
  assert.match(
    css,
    /prefers-reduced-motion: reduce\) \{[^@]*\.is-now \.mesa-step-dot \{[^}]*animation: none/,
  );
});

test("en la línea de tiempo, el punto de cada evento es del color de quien lo manda", () => {
  assert.match(block, /\.mesa-event::before \{[^}]*background: var\(--agent\)/);
  assert.match(block, /\.mesa-event\.is-you::before \{[^}]*var\(--human\)/);
  assert.match(block, /\.mesa-event\.is-togi::before \{[^}]*var\(--ink\)/);
});

test("la plaza de la tarea abierta se marca en el mapa", () => {
  assert.match(css, /\.mesa-map \.is-selected \.mesa-node \{[^}]*box-shadow/);
});
