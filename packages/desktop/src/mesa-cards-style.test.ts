import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// El estilo de las tarjetas del lateral por tarea (4d-3): solo con los tokens de la marca.
const css = readFileSync(join(import.meta.dirname, "app.css"), "utf8");
const start = css.indexOf("/* El lateral por tarea (MesaCards.ts)");
// El bloque llega hasta el de los pasos (4d-4) o, si aún no está, hasta el del mapa.
const steps = css.indexOf("/* Los pasos: puntos");
const block = css.slice(start, steps > start ? steps : css.indexOf("/* El mapa sobre React Flow"));

test("las tarjetas usan los tokens de la marca: ningún color escrito a mano", () => {
  assert.ok(start >= 0 && block.length > 0, "falta el bloque de las tarjetas");
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
});

test("lo que te espera, en human; lo que está en curso, en agent; lo reciente, apagado", () => {
  assert.match(block, /\.mesa-card\.is-you \{[^}]*border-color: var\(--human\)/);
  assert.match(block, /\.mesa-card\.is-active \{[^}]*border-color: var\(--agent\)/);
  assert.match(block, /\.mesa-card\.is-quiet \{[^}]*opacity: 0\.6/);
});

test("a las tarjetas no les llegan las reglas de las filas del registro", () => {
  assert.match(block, /\.mesa-log \.mesa-card \{[^}]*padding: 10px 12px/);
  assert.match(block, /\.mesa-log \.mesa-cards \{[^}]*border: 0/);
});

test("el título largo se corta con puntos suspensivos y no empuja al estado", () => {
  assert.match(block, /\.mesa-card-title \{[^}]*min-width: 0;[^}]*text-overflow: ellipsis/);
  assert.match(block, /\.mesa-card-chip \{[^}]*white-space: nowrap/);
});
