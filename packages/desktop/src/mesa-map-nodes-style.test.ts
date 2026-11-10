import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// El estilo de los nodos del mapa sobre React Flow (4c-5): como la pantalla 5 del diseño y solo con
// los tokens de la marca.
const css = readFileSync(join(import.meta.dirname, "app.css"), "utf8");
const block = css.slice(
  css.indexOf("/* Los nodos del mapa sobre React Flow"),
  css.indexOf("/* Un mensaje recorre su arista una vez"),
);

test("los nodos del mapa usan los tokens de la marca: ningún color escrito a mano", () => {
  assert.ok(block.length > 0, "falta el bloque de los nodos del mapa");
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
});

test("togi en negativo; tú, en human; las plazas en curso, en agent; las terminadas, a trazos", () => {
  assert.match(
    block,
    /\.mesa-node\.is-togi \{[^}]*color: var\(--bg\);[^}]*background: var\(--ink\)/,
  );
  assert.match(block, /\.mesa-node\.is-waiting \{[^}]*border-color: var\(--human\)/);
  assert.match(block, /\.mesa-node\.is-active \{[^}]*border-color: var\(--agent\)/);
  assert.match(block, /\.mesa-node\.is-done \{[^}]*border-style: dashed/);
});

test("el asidero no se ve ni se puede usar", () => {
  assert.match(block, /\.mesa-handle \{[^}]*opacity: 0;[^}]*pointer-events: none/);
});

test("los nodos nuevos no tocan la mesa SVG de ahora: todo va dentro de .mesa-map o con clases nuevas", () => {
  for (const rule of block.match(/^[^\s/@}][^{]*\{/gm) ?? []) {
    assert.match(rule, /\.mesa-map |\.mesa-(seat|label|row|meta)\b/, rule);
  }
});
