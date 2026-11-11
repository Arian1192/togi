import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// El panel derecho se abre y se cierra con una transición, no de golpe: el ancho, el relleno y la
// opacidad van a cero antes de ocultarse, y parten de cero al mostrarse. Sin transición al arrastrar
// el borde ni con «reducir movimiento».

const css = readFileSync(join(import.meta.dirname, "app.css"), "utf8");
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `falta la regla ${selector}`);
  return css.slice(start, css.indexOf("}", start));
};

test("el ancho, el relleno, la opacidad y el display del panel tienen transición", () => {
  const panel = rule(".mesa-screen > .mesa-log");
  assert.match(panel, /transition:[^;]*flex-basis \d+ms/);
  assert.match(panel, /transition:[^;]*padding \d+ms/);
  assert.match(panel, /transition:[^;]*opacity \d+ms/);
  assert.match(panel, /transition:[^;]*display \d+ms allow-discrete/);
});

test("plegado, el panel llega a ancho cero antes de ocultarse", () => {
  const closed = rule(".mesa-screen > .mesa-log[hidden]");
  for (const decl of ["display: none", "flex-basis: 0", "padding-inline: 0", "opacity: 0"]) {
    assert.ok(closed.includes(decl), decl);
  }
});

test("al desplegarse parte de ancho cero", () => {
  assert.match(
    css,
    /@starting-style \{\s*\.mesa-screen > \.mesa-log:not\(\[hidden\]\) \{[^}]*flex-basis: 0;[^}]*opacity: 0;/,
  );
});

test("arrastrando el borde o con «reducir movimiento», sin transición", () => {
  assert.match(
    css,
    /\.mesa-screen:has\(\.mesa-edge-grip:active\) > \.mesa-log \{\s*transition: none;/,
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.mesa-screen > \.mesa-log \{\s*transition: none;/,
  );
});
