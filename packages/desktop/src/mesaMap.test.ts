import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MesaMap } from "./MesaMap.ts";
import { applyHeader, EMPTY, type Header, type MesaState, type Who } from "./mesa.ts";

// El mapa de la mesa sobre React Flow: se mueve, pero no deja tocar quién habla con quién.

const at = "2026-11-10T09:30:00.000Z";
const h = (seq: number, number: number, name: string, actor: Who, session: string): Header => ({
  seq,
  at,
  number,
  name,
  actor,
  session,
});
const togi: Who = { kind: "system", component: "adapter:planner" };
const play = (...hs: Header[]) => hs.reduce(applyHeader, EMPTY as MesaState);

const render = (state: MesaState) =>
  renderToStaticMarkup(createElement(MesaMap, { state, waiting: 1 }));

test("el mapa dice cuántas sesiones siguen activas y pinta la mesa con su fondo de puntos", () => {
  const out = render(
    play(
      h(1, 7, "session.started", togi, "sa"),
      h(2, 8, "session.started", togi, "sb"),
      h(3, 8, "session.ended", togi, "sb"),
    ),
  );
  assert.match(out, /class="mesa-map" aria-label="Mesa en vivo: 1 sesiones activas"/);
  assert.match(out, /react-flow__background/);
  assert.match(out, /<pattern[^>]*id="pattern-/);
  assert.equal((out.match(/class="mesa-edge"/g) ?? []).length, 3, "tú y las dos plazas");
});

test("sin el enlace de React Flow: nada en la mesa lleva fuera de la app", () => {
  const out = render(play(h(1, 7, "session.started", togi, "sa")));
  assert.doesNotMatch(out, /<a /);
  assert.doesNotMatch(out, /react-flow__attribution/);
});

test("lleva los botones para acercar, alejar y encuadrar, y el recordatorio de cómo habla la mesa", () => {
  const out = render(EMPTY);
  assert.equal((out.match(/class="react-flow__controls-button/g) ?? []).length, 3);
  assert.doesNotMatch(out, /controls-interactive/, "sin el candado: la mesa nunca se edita");
  assert.match(out, /Los agentes no se hablan entre sí: cada mensaje pasa por togi/);
});
