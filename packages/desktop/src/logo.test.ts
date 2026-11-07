import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SRC = import.meta.dirname;
const css = readFileSync(join(SRC, "app.css"), "utf8");
const app = readFileSync(join(SRC, "App.tsx"), "utf8");
const manual = readFileSync(
  join(SRC, "..", "..", "..", "docs", "marca", "manual-de-marca.md"),
  "utf8",
);

/** Las declaraciones del bloque CSS de un selector. */
const rule = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `falta ${selector}`);
  return css.slice(start, css.indexOf("}", start));
};

test("el logotipo es el monograma y «togi» en minúsculas, en Shippori Mincho 600 (font-display)", () => {
  assert.match(app, /<div className="logo">\s*<Monogram \/>\s*<span>togi<\/span>\s*<\/div>/);
  assert.doesNotMatch(app, /Togi|TOGI/);
  assert.match(rule(".logo"), /font:\s*600 [\w.]+ \/ 1 var\(--font-display\)/);
});

test("el monograma mide 1,2 veces el cuerpo de la letra y la separación 0,28 veces el monograma", () => {
  const logo = rule(".logo");
  const mark = Number(/--logo-mark:\s*([\d.]+)em;/.exec(logo)?.[1]);
  const gap = Number(/gap:\s*calc\(var\(--logo-mark\) \* ([\d.]+)\);/.exec(logo)?.[1]);
  assert.equal(mark, 1.2);
  assert.equal(gap, 0.28);
  // Ese es el único tamaño del monograma: sin width ni height fijos en el SVG.
  assert.match(rule(".monogram"), /width:\s*var\(--logo-mark\);\s*height:\s*var\(--logo-mark\);/);
  assert.doesNotMatch(app, /<svg[^>]*\b(width|height)=/);
});

test("con el ejemplo del manual (texto de 60 px) salen 72 px de monograma y unos 20 px de separación", () => {
  assert.match(manual, /monograma de 72 px, texto de 60 px, 20 px entre ambos/);
  const body = 60;
  const monogram = body * 1.2;
  const separation = monogram * 0.28;
  assert.equal(monogram, 72);
  assert.ok(Math.abs(separation - 20) < 0.5, `${separation}`);
});

test("la versión y el commit son identificadores: van en un elemento con font-mono", () => {
  assert.match(app, /<code className="ident">\{status\.version\}<\/code>/);
  assert.match(rule(".ident"), /font:\s*400 14px \/ 22px var\(--font-mono\)/);
});
