import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// El estilo de la mesa en vivo (4b-2b): solo tokens y una animación que se puede apagar.
const css = readFileSync(join(import.meta.dirname, "app.css"), "utf8");
const block = (from: string, to: string) => css.slice(css.indexOf(from), css.indexOf(to));

test("el mensaje recorre su arista con CSS y, sin movimiento, solo la marca", () => {
  assert.match(css, /@keyframes mesa-travel/);
  assert.match(css, /\.mesa-pulse \{[^}]*animation: mesa-travel/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{[^@]*\.mesa-pulse \{[^}]*animation: none/);
});

test("la mesa usa los tokens de la marca: ningún color escrito a mano", () => {
  const mesa = block("/* Las vistas de la barra de título", "/* Columna lateral: transiciones");
  assert.ok(mesa.length > 0, "falta el bloque de la mesa");
  assert.doesNotMatch(mesa, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
  for (const token of ["--agent", "--human", "--border", "--ink"]) {
    assert.ok(mesa.includes(`var(${token})`), token);
  }
});

test("quien te espera destaca con el color human; las plazas en curso, con el de los agentes", () => {
  assert.match(css, /\.mesa-node\.is-waiting rect \{[^}]*stroke: var\(--human\)/);
  assert.match(css, /\.mesa-node\.is-active rect \{[^}]*stroke: var\(--agent\)/);
  assert.match(css, /\.mesa-node\.is-done \{[^}]*opacity: 0\.45/);
});
