import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MesaScreen } from "./MesaView.ts";
import { EMPTY } from "./mesa.ts";
import {
  clampWidth,
  dragged,
  isPanelShortcut,
  PANEL_DEFAULT,
  PANEL_MAX,
  PANEL_MIN,
  readPanel,
  writePanel,
} from "./panelState.ts";

// El panel derecho de la mesa (ADR-010 §3, enmienda del 11 de noviembre): acoplado, plegable con
// ⌘⌥\, redimensionable y con memoria.

const keys = { key: "\\", metaKey: true, altKey: true, ctrlKey: false, shiftKey: false };
const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};
const screen = (open: boolean, width = 320) =>
  renderToStaticMarkup(
    createElement(MesaScreen, { state: EMPTY, waiting: 0, panel: { open, width } }),
  );

test("abierto, el panel es el lateral de siempre, con su borde delante y su ancho en la mesa", () => {
  const out = screen(true, 400);
  assert.match(
    out,
    /<section class="mesa-screen" aria-label="Mesa en vivo" style="--mesa-panel-width:400px">/,
  );
  assert.match(
    out,
    /<div class="mesa-edge"><div class="mesa-edge-grip" role="separator"[^>]*aria-valuenow="400"/,
  );
  assert.match(out, /aria-expanded="true"[^>]*>›<\/button><\/div><aside class="mesa-log"/);
});

test("plegado, el lateral se oculta: queda el riel con el botón para desplegarlo", () => {
  const out = screen(false);
  assert.match(out, /<aside class="mesa-log" aria-label="[^"]*" hidden="">/);
  assert.doesNotMatch(screen(true), /<aside[^>]*hidden/);
  assert.doesNotMatch(out, /mesa-edge-grip/);
  assert.match(
    out,
    /<div class="mesa-edge is-closed"><button[^>]*aria-label="Desplegar el panel \(⌘⌥\\\)"[^>]*aria-expanded="false"/,
  );
});

test("el ancho del panel sale de la variable, 320 px si no hay ninguna", () => {
  const css = readFileSync(join(import.meta.dirname, "app.css"), "utf8");
  assert.match(
    css,
    /\.mesa-screen > \.mesa-log \{\s*flex-basis: var\(--mesa-panel-width, 320px\);/,
  );
  assert.match(css, /\.mesa-edge-grip \{[^}]*cursor: col-resize/);
});

test("⌘⌥\\ pliega el panel, también por la tecla física; ⌘\\ es de la columna", () => {
  assert.equal(isPanelShortcut(keys), true);
  assert.equal(isPanelShortcut({ ...keys, key: "«", code: "Backslash" }), true);
  assert.equal(isPanelShortcut({ ...keys, altKey: false }), false);
  assert.equal(isPanelShortcut({ ...keys, shiftKey: true }), false);
  assert.equal(isPanelShortcut({ ...keys, ctrlKey: true }), false);
  assert.equal(isPanelShortcut({ ...keys, metaKey: false }), false);
  assert.equal(isPanelShortcut({ ...keys, key: "a" }), false);
});

test("el ancho se queda entre los límites", () => {
  assert.equal(clampWidth(100), PANEL_MIN);
  assert.equal(clampWidth(9000), PANEL_MAX);
  assert.equal(clampWidth(333.6), 334);
  assert.equal(clampWidth(Number.NaN), PANEL_DEFAULT.width);
});

test("arrastrar el borde a la izquierda ensancha el panel", () => {
  assert.equal(dragged(320, 800, 700), 420);
  assert.equal(dragged(320, 800, 900), 260);
  assert.equal(dragged(600, 800, 100), PANEL_MAX);
});

test("recuerda si está abierto y su ancho", () => {
  const store = memory();
  assert.deepEqual(readPanel(store), PANEL_DEFAULT);
  writePanel(store, { open: false, width: 410 });
  assert.deepEqual(readPanel(store), { open: false, width: 410 });
});

test("lo guardado que no se entiende vuelve a lo de siempre, campo a campo", () => {
  const store = memory();
  store.setItem("togi.mesa.panel", "no es json");
  assert.deepEqual(readPanel(store), PANEL_DEFAULT);
  store.setItem("togi.mesa.panel", JSON.stringify({ open: "sí", width: 5000 }));
  assert.deepEqual(readPanel(store), { open: true, width: PANEL_MAX });
  store.setItem("togi.mesa.panel", "null");
  assert.deepEqual(readPanel(store), PANEL_DEFAULT);
});

test("sin almacenamiento, o si falla, el panel funciona sin recordar", () => {
  assert.deepEqual(readPanel(undefined), PANEL_DEFAULT);
  const broken = {
    getItem: () => {
      throw new Error("no");
    },
    setItem: () => {
      throw new Error("no");
    },
  };
  assert.deepEqual(readPanel(broken), PANEL_DEFAULT);
  assert.doesNotThrow(() => writePanel(broken, PANEL_DEFAULT));
});
