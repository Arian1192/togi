import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { railState, TRANSITION_MS } from "./ProjectColumn.ts";

const css = readFileSync(join(import.meta.dirname, "app.css"), "utf8");
const rule = (selector: string): string => {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `falta la regla ${selector}`);
  return css.slice(start, css.indexOf("}", start));
};

test("el ancho de la columna se anima con ease-in-out, y su duración es la que espera el componente", () => {
  const col = rule(".project-col");
  assert.match(col, /transition:\s*[^;]*width [0-9]+ms cubic-bezier\(0\.65, 0, 0\.35, 1\)/);
  const ms = Number(/width ([0-9]+)ms/.exec(col)?.[1]);
  assert.equal(ms, TRANSITION_MS);
});

test("con «reducir movimiento» no hay transición", () => {
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.project-col \{[^}]*transition: none/,
  );
});

test("el relleno también se anima, para que el riel no salte al final", () => {
  assert.match(rule(".project-col"), /padding-inline [0-9]+ms/);
});

test("desplegada, el contenido tiene un ancho fijo y se recorta como un cajón, sin deformarse", () => {
  assert.match(css, /\.project-col:not\(\.is-rolled\) > \.col-head[^{]*\{[^}]*min-width: 272px/);
});

test("el estilo del riel va con el contenido plegado (is-rolled), no con el ancho en curso", () => {
  assert.match(css, /\.project-col\.is-rolled \{[^}]*align-items: center/);
  assert.match(css, /\.is-rolled \.col-scroll \{/);
  assert.match(css, /\.is-rolled \.col-head \{/);
  assert.doesNotMatch(css, /\.is-rail \.col-(scroll|head)/);
});

test("al plegar, el ancho cambia ya pero el contenido plegado espera a que acabe la transición", () => {
  assert.deepEqual(railState(true, false), { className: "project-col is-rail", showRail: false });
  assert.deepEqual(railState(true, true), {
    className: "project-col is-rail is-rolled",
    showRail: true,
  });
});

test("al desplegar, el contenido desplegado aparece de inmediato aunque el riel no esté 'asentado'", () => {
  assert.deepEqual(railState(false, true), { className: "project-col", showRail: false });
  assert.deepEqual(railState(false, false), { className: "project-col", showRail: false });
});

test("la columna no queda atada al ancho de su contenido: puede encogerse mientras el contenido se recorta", () => {
  // Un elemento flex no baja de su contenido (`min-width: auto`): con el contenido desplegado a
  // 272px la columna se quedaría en 288px hasta el cambio de contenido y saltaría de golpe.
  assert.match(rule(".project-col"), /min-width: 0/);
});
