import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// El estilo de la línea de tiempo de Actividad (pantalla 4 del diseño): solo tokens de la marca, así
// sirve igual en claro y en oscuro (ADR-010 §7).
const css = readFileSync(join(import.meta.dirname, "app.css"), "utf8");
const start = css.indexOf("/* La línea de tiempo de Actividad");
const end = css.indexOf("/* Fin de la línea de tiempo de Actividad */");
const block = css.slice(start, end);
const rule = (selector: string) => {
  const at = block.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `falta ${selector}`);
  return block.slice(at, block.indexOf("}", at));
};

test("la línea de tiempo no escribe ningún color: solo variables de la marca", () => {
  assert.ok(start >= 0 && end > start, "falta el bloque de Actividad");
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
  for (const m of block.matchAll(/var\(--([a-z0-9-]+)/g)) {
    assert.match(
      m[1] ?? "",
      /^(bg|surface|border|ink|ink-muted|human|agent|done|font-[a-z]+|space-\d+|radius-[a-z]+)$/,
    );
  }
});

test("el aro y el veredicto toman el color de su clase de tono", () => {
  assert.match(rule(".mc-ring"), /border: 2px solid currentColor/);
  assert.doesNotMatch(rule(".mc-ring"), /\bcolor:/);
  assert.doesNotMatch(rule(".mc-verdict"), /\bcolor:/);
});

test("un gate que no pasa va en human; el que pasa, en done", () => {
  assert.match(rule(".mc-chk span::before"), /content: "✓";[\s\S]*color: var\(--done\)/);
  assert.match(rule(".mc-chk span:not(.is-pass)"), /color: var\(--human\)/);
  assert.match(rule(".mc-chk span:not(.is-pass)::before"), /content: "✕"/);
});

test("la tarjeta es una superficie con borde; el adjunto, sobre el fondo", () => {
  assert.match(rule(".mc-card"), /background: var\(--surface\)/);
  assert.match(rule(".mc-card"), /border-radius: var\(--radius-lg\)/);
  assert.match(rule(".mc-att"), /background: var\(--bg\)/);
  assert.match(rule(".mc-ava"), /color: var\(--bg\)/);
});
