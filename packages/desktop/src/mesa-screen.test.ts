import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MesaScreen } from "./MesaView.ts";
import { applyHeader, EMPTY, type Header } from "./mesa.ts";

// La pantalla de la mesa como la 5 del diseño (4c-8): ocupa todo el centro, con la cabecera encima
// del mapa, el lateral a toda altura y el título de cada tarea encima de su plaza.

const at = "2026-11-10T09:30:00.000Z";
const started: Header = {
  seq: 1,
  at,
  number: 7,
  name: "session.started",
  actor: { kind: "system", component: "adapter:planner" },
  session: "sa",
};
const read = (file: string) => readFileSync(join(import.meta.dirname, file), "utf8");

test("la cabecera va encima del mapa y el lateral, a su lado, con su título", () => {
  const s = applyHeader(EMPTY, started);
  const out = renderToStaticMarkup(createElement(MesaScreen, { state: s, waiting: 0 }));
  assert.match(
    out,
    /<div class="mesa-main"><header class="mesa-head"><h1>Mesa en vivo<\/h1><span class="mesa-live"><svg[^>]*class="glyph"[\s\S]*?<\/svg>en vivo · seq 1<\/span><\/header><div class="mesa-map"/,
  );
  assert.match(
    out,
    /<aside class="mesa-log" aria-label="Lo último que ha pasado por togi"><h2>Lo último que ha pasado por togi<\/h2>/,
  );
});

test("cada plaza lleva encima el título de su tarea", () => {
  const s = applyHeader(EMPTY, started);
  const titles = new Map([[7, "Exportar promociones a CSV"]]);
  const out = renderToStaticMarkup(createElement(MesaScreen, { state: s, waiting: 0, titles }));
  assert.match(out, /mesa-label">#7 · Exportar promociones a CSV</);
});

test("la app pasa a la mesa los títulos que no están borrados y la deja sin márgenes", () => {
  const app = read("App.tsx");
  assert.match(app, /t\.title !== null && !t\.titleErased/);
  assert.match(app, /<MesaPane[\s\S]*?titles=\{titles\}/);
  assert.match(app, /view\.kind === "mesa" \? "shell is-mesa" : "shell"/);
  assert.match(
    read("MesaPane.tsx"),
    /<MesaScreen state=\{state\} waiting=\{waiting\} titles=\{titles\} \/>/,
  );
});

test("la mesa ocupa todo el centro: sin márgenes y con el lateral a toda altura", () => {
  const css = read("app.css");
  assert.match(
    css,
    /\.workbench > \.shell\.is-mesa \{[^}]*height: 100vh;[^}]*padding: var\(--titlebar-height\) 0 0/,
  );
  assert.match(css, /\.mesa-head \{[^}]*height: 48px/);
  assert.match(css, /\.mesa-log \{[^}]*flex: 0 0 320px;[^}]*overflow-y: auto/);
});
