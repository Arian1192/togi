import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// La transición sigue al Sidebar de shadcn (components/ui/sidebar.tsx): 200 ms, lineal, un solo DOM
// (el contenido no se cambia, se recorta o se desvanece) y solo se anima el ancho y la opacidad.

const SRC = import.meta.dirname;
const css = readFileSync(join(SRC, "app.css"), "utf8");
const column = readFileSync(join(SRC, "ProjectColumn.ts"), "utf8");
const app = readFileSync(join(SRC, "App.tsx"), "utf8");

/** Todas las declaraciones de las reglas cuyo selector (de una lista) es exactamente `selector`. */
const declarations = (selector: string): string =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .map((chunk) => chunk.split("{"))
    .filter(
      ([sel, body]) => body !== undefined && sel?.split(",").some((s) => s.trim() === selector),
    )
    .map(([, body]) => body)
    .join(";");

test("el ancho y el relleno de la columna se animan 200 ms lineales, como en shadcn", () => {
  const col = declarations(".project-col");
  assert.match(col, /transition:\s*[^;]*width 200ms linear/);
  assert.match(col, /padding-inline 200ms linear/);
});

test("la columna no queda atada al ancho de su contenido: puede encogerse mientras se recorta", () => {
  assert.match(declarations(".project-col"), /min-width: 0/);
});

test("un solo DOM: el componente no cambia de contenido ni tiene temporizadores", () => {
  assert.doesNotMatch(column, /useState|useEffect|setTimeout|railState|useSettled|TRANSITION_MS/);
  assert.doesNotMatch(app, /useSettled|settled/);
});

test("las etiquetas y los contadores se desvanecen en la primera mitad y el icono entra en la segunda, sin solaparse", () => {
  // Plegando: lo de la columna ancha se va en los primeros 100 ms y el icono entra desde los 100 ms.
  for (const sel of [".col-label", ".col-counts"]) {
    assert.match(declarations(`.is-collapsed ${sel}`), /opacity: 0/, `${sel} plegada`);
    assert.match(
      declarations(`.is-collapsed ${sel}`),
      /transition: opacity 100ms linear;?\s*$/,
      sel,
    );
    assert.match(declarations(sel), /transition: opacity 100ms linear 100ms/, `${sel} desplegando`);
  }
  for (const sel of [".col-initial", ".rail-badge"]) {
    assert.match(
      declarations(`.is-collapsed ${sel}`),
      /transition: opacity 100ms linear 100ms/,
      sel,
    );
    assert.match(declarations(sel), /transition: opacity 100ms linear;?\s*$/, `${sel} desplegando`);
  }
});

test("el texto de los botones y del pie no se parte en dos líneas al estrecharse: se recorta", () => {
  assert.match(declarations(".col-pending"), /white-space: nowrap/);
  assert.match(declarations(".col-name"), /white-space: nowrap/);
  assert.match(declarations(".col-foot"), /white-space: nowrap/);
});

test("las tareas de cada proyecto pliegan su altura (grid 1fr → 0fr) para que las filas de debajo no salten", () => {
  assert.match(declarations(".col-tasks-wrap"), /grid-template-rows: 1fr/);
  assert.match(declarations(".col-tasks-wrap"), /transition:[^;]*grid-template-rows 200ms linear/);
  assert.match(declarations(".col-tasks-inner"), /overflow: hidden/);
  const closed = declarations(".is-collapsed .col-tasks-wrap");
  assert.match(closed, /grid-template-rows: 0fr/);
  assert.match(closed, /opacity: 0/);
});

test("lo que desaparece deja de ser enfocable al acabar la transición, no antes", () => {
  for (const sel of [".col-tasks-wrap", ".col-toggle"]) {
    const closed = declarations(`.is-collapsed ${sel}`);
    assert.match(closed, /visibility: hidden/, sel);
    assert.match(closed, /visibility 0s linear 200ms/, sel);
  }
});

test("la flecha de plegar un proyecto, el estado del daemon y el texto de la marca se recogen sin saltos", () => {
  assert.match(declarations(".col-toggle"), /transition:[^;]*width 200ms linear/);
  assert.match(declarations(".is-collapsed .col-toggle"), /width: 0/);
  assert.match(declarations(".col-foot"), /transition:[^;]*max-height 200ms linear/);
  assert.match(declarations(".is-collapsed .col-foot"), /max-height: 0/);
  assert.match(declarations(".col-head .logo span"), /transition:[^;]*max-width 200ms linear/);
  assert.match(declarations(".is-collapsed .col-head .logo span"), /max-width: 0/);
});

test("todas las transiciones de la columna caben en 200 ms: 200 (o 100 + 100 de espera) y 0 s de la visibilidad", () => {
  const start = css.indexOf("/* Columna lateral: transiciones");
  assert.notEqual(start, -1, "falta el bloque de transiciones de la columna");
  const block = css.slice(start);
  const durations = [...block.matchAll(/transition:([^;]*);/g)].flatMap((m) =>
    [...(m[1] ?? "").matchAll(/(?<![a-z-])([0-9.]+m?s)\b/g)].map((d) => d[1]),
  );
  assert.ok(durations.length >= 8, "se esperaban varias transiciones");
  for (const d of durations) assert.match(d ?? "", /^(200ms|100ms|0s)$/);
});

test("con «reducir movimiento» no hay transiciones en la columna", () => {
  const media = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(media, /\.project-col,\s*\.project-col \*[^{]*\{[^}]*transition: none/);
});
