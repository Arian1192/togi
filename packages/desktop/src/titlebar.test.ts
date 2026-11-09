import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TitleBar } from "./TitleBar.ts";

// El control que pliega la columna va en la barra de título, junto a los semáforos, como en T3.
// Sustituye al asa que cabalgaba sobre la línea de la columna (chocaba con las insignias del riel).

const SRC = import.meta.dirname;
const TAURI = join(SRC, "..", "src-tauri");
const css = readFileSync(join(SRC, "app.css"), "utf8");
const app = readFileSync(join(SRC, "App.tsx"), "utf8");
const column = readFileSync(join(SRC, "ProjectColumn.ts"), "utf8");

const rule = (selector: string): string => {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `falta la regla ${selector}`);
  return css.slice(start, css.indexOf("}", start));
};
const html = (collapsed: boolean, fullscreen = false) =>
  renderToStaticMarkup(createElement(TitleBar, { collapsed, onCollapse: () => {}, fullscreen }));

type El = { type: unknown; props: Record<string, unknown> };
function find(node: ReactNode, test: (el: El) => boolean): El[] {
  if (Array.isArray(node)) return node.flatMap((n) => find(n, test));
  if (!isValidElement(node)) return [];
  const el = node as unknown as El;
  return [...(test(el) ? [el] : []), ...find(el.props.children as ReactNode, test)];
}

test("el botón conserva el nombre accesible, el estado y el atajo", () => {
  const open = html(false);
  assert.match(open, /<button[^>]*aria-label="Plegar la columna"[^>]*>/);
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /title="Plegar la columna \(⌘\\\)"/);
  const closed = html(true);
  assert.match(closed, /<button[^>]*aria-label="Desplegar la columna"[^>]*>/);
  assert.match(closed, /aria-expanded="false"/);
});

test("el icono es panel-left de Lucide, decorativo y con el trazo de la marca", () => {
  const out = html(false);
  assert.match(out, /<svg[^>]*aria-hidden="true"/);
  assert.match(out, /<rect[^>]*width="18"[^>]*height="18"/);
  assert.match(out, /<path d="M9 3v18"/);
  assert.match(out, /stroke-width="1.5"/);
});

test("el botón avisa al pulsarlo", () => {
  let calls = 0;
  const tree = TitleBar({ collapsed: false, onCollapse: () => calls++, fullscreen: false });
  const [button] = find(tree, (el) => el.type === "button");
  assert.ok(button);
  (button.props.onClick as () => void)();
  assert.equal(calls, 1);
});

test("la barra arrastra la ventana, pero el botón no", () => {
  const out = html(false);
  assert.match(out, /<header[^>]*data-tauri-drag-region="true"/);
  assert.doesNotMatch(out, /<button[^>]*data-tauri-drag-region/);
});

test("deja sitio a los semáforos salvo a pantalla completa, donde macOS los oculta", () => {
  assert.match(html(false), /data-fullscreen="false"/);
  assert.match(html(false, true), /data-fullscreen="true"/);
  assert.match(rule(".titlebar"), /padding: 0 var\(--space-3\) 0 var\(--traffic-lights\)/);
  assert.match(rule('.titlebar[data-fullscreen="true"]'), /padding-left: var\(--space-3\)/);
});

test("la barra va fija arriba y la columna y el centro empiezan debajo", () => {
  const bar = rule(".titlebar");
  assert.match(bar, /position: fixed/);
  assert.match(bar, /height: var\(--titlebar-height\)/);
  assert.match(rule(".workbench > .project-col"), /padding-top: calc\(var\(--titlebar-height\)/);
  assert.match(rule(".workbench > .shell"), /padding-top: calc\(var\(--titlebar-height\)/);
});

test("el foco y el hover se ven con los tokens", () => {
  assert.match(rule(".titlebar-toggle:hover"), /color: var\(--ink\)/);
  assert.match(rule(".titlebar-toggle:focus-visible"), /outline: 2px solid var\(--ink\)/);
});

test("ya no hay asa sobre la línea de la columna", () => {
  assert.doesNotMatch(css, /\.col-handle/);
  assert.doesNotMatch(column, /col-handle|onCollapse/);
});

test("App pone la barra con el estado de la columna y escucha la pantalla completa", () => {
  assert.match(app, /<TitleBar/);
  assert.match(app, /onCollapse=\{\(\) => setCollapsed\(\(prev\) => !prev\)\}/);
  assert.match(app, /listen<boolean>\("window-fullscreen"/);
});

test("la ventana pinta su propia barra y Rust avisa de la pantalla completa", () => {
  const conf = JSON.parse(readFileSync(join(TAURI, "tauri.conf.json"), "utf8")) as {
    app: { windows: Record<string, unknown>[] };
  };
  const [main] = conf.app.windows;
  assert.equal(main?.titleBarStyle, "Overlay");
  assert.equal(main?.hiddenTitle, true);
  const lib = readFileSync(join(TAURI, "src", "lib.rs"), "utf8");
  assert.match(lib, /WindowEvent::Resized/);
  assert.match(lib, /window\.emit\("window-fullscreen", fullscreen\)/);
});
