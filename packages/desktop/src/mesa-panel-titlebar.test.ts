import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MesaScreen } from "./MesaView.ts";
import { EMPTY } from "./mesa.ts";
import { PanelContext } from "./PanelEdge.ts";
import { TitleBar } from "./TitleBar.ts";

// El control del panel derecho va en la barra de título, en espejo del de la columna (ADR-010 §3,
// «Panel derecho»; pantalla 5 del diseño): icono panel-right al final de la barra, solo en la mesa.

const read = (file: string) => readFileSync(join(import.meta.dirname, file), "utf8");
const base = { collapsed: false, onCollapse: () => {}, fullscreen: false };
const bar = (open?: boolean) =>
  renderToStaticMarkup(
    createElement(TitleBar, {
      ...base,
      ...(open === undefined ? {} : { panel: { open, onToggle: () => {} } }),
    }),
  );

type El = { type: unknown; props: Record<string, unknown> };
function find(node: ReactNode, pick: (el: El) => boolean): El[] {
  if (Array.isArray(node)) return node.flatMap((n) => find(n, pick));
  if (!isValidElement(node)) return [];
  const el = node as unknown as El;
  return [...(pick(el) ? [el] : []), ...find(el.props.children as ReactNode, pick)];
}

test("en la mesa, la barra termina con el control del panel, con su estado y su atajo", () => {
  const open = bar(true);
  assert.match(
    open,
    /<button type="button" class="titlebar-toggle titlebar-panel" aria-label="Plegar el panel" aria-expanded="true" title="Plegar el panel \(⌘⌥\\\)">/,
  );
  assert.match(
    open,
    /titlebar-panel[\s\S]*<path d="M15 3v18"[^>]*stroke-width="1.5"[^>]*><\/path><\/svg><\/button><\/header>$/,
  );
  const closed = bar(false);
  assert.match(closed, /aria-label="Desplegar el panel" aria-expanded="false"/);
  assert.match(closed, /title="Desplegar el panel \(⌘⌥\\\)"/);
});

test("fuera de la mesa, la barra no lleva el control del panel", () => {
  assert.doesNotMatch(bar(), /titlebar-panel|el panel/);
});

test("el control del panel avisa al pulsarlo", () => {
  let calls = 0;
  const tree = TitleBar({ ...base, panel: { open: true, onToggle: () => calls++ } });
  const [button] = find(tree, (el) => el.props.className === "titlebar-toggle titlebar-panel");
  assert.ok(button);
  (button.props.onClick as () => void)();
  assert.equal(calls, 1);
});

test("la mesa usa el panel que le da la app", () => {
  const out = renderToStaticMarkup(
    createElement(
      PanelContext.Provider,
      { value: [{ open: false, width: 300 }, () => {}] },
      createElement(MesaScreen, { state: EMPTY, waiting: 0 }),
    ),
  );
  assert.match(out, /style="--mesa-panel-width:300px"/);
  assert.match(out, /<aside class="mesa-log"[^>]*hidden="">/);
});

test("la app sube el estado del panel y da el control a la barra solo en la mesa", () => {
  const app = read("App.tsx");
  assert.match(app, /usePanel\(undefined, onMesa\)/);
  assert.match(app, /<PanelContext\.Provider value=\{panelState\}>/);
  assert.match(
    app,
    /\.\.\.\(onMesa \? \{ panel: \{ open: panel\.open, onToggle: togglePanel \} \} : \{\}\)/,
  );
});

test("ni botón en el borde ni riel: el control de la barra se empuja al final", () => {
  const css = read("app.css");
  assert.doesNotMatch(css, /\.mesa-edge-toggle|\.mesa-edge\.is-closed/);
  assert.match(css, /\.titlebar-panel \{\s*margin-left: auto;/);
});
