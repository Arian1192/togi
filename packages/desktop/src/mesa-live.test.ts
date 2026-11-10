import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MesaScreen } from "./MesaView.ts";
import { applyHeader, EMPTY, type Header, seed, type Who, whoLabel } from "./mesa.ts";
import { TitleBar } from "./TitleBar.ts";
import { PENDING, tasksFor, viewShortcut } from "./viewState.ts";

// La mesa en vivo en la app (4b-2a): sembrar lo que ya está en curso, el registro, la vista entera y
// ⌘1 y ⌘2. El estilo, en mesa-style.test.ts; el cableado, en mesa-wiring.test.ts.

const togi: Who = { kind: "system", component: "adapter:planner" };
const h = (seq: number, number: number, name: string, actor: Who, session?: string): Header => ({
  seq,
  at: "2026-11-10T09:30:05.000Z",
  number,
  name,
  actor,
  ...(session === undefined ? {} : { session }),
});

test("al abrir la mesa, cada planificador en curso tiene su plaza, y su etiqueta la adopta sin duplicarla", () => {
  const sown = seed([7, 9], 40);
  assert.deepEqual(
    sown.seats.map((s) => [s.key, s.active]),
    [
      ["planner#7", true],
      ["planner#9", true],
    ],
  );
  const s = applyHeader(sown, h(41, 7, "plan.proposed", { kind: "agent", role: "planner" }, "sx"));
  assert.deepEqual(
    s.seats.map((x) => x.key),
    ["sx", "planner#9"],
  );
  assert.equal(applyHeader(sown, h(40, 7, "plan.proposed", togi, "sy")), sown, "lo ya contado no");
});

test("quién, con los nombres de la interfaz: tú, togi o el rol del ADR-009", () => {
  assert.equal(whoLabel({ kind: "human" }), "tú");
  assert.equal(whoLabel(togi), "togi");
  assert.equal(whoLabel({ kind: "agent", role: "planner" }), "Planificador");
  assert.equal(whoLabel({ kind: "system", component: "gates" }), "Gates");
  assert.equal(whoLabel({ kind: "agent", role: "desconocido" }), "agente");
});

test("el registro lista lo último que pasó por togi, más reciente primero, también lo de fuera de la mesa", () => {
  let s = EMPTY;
  s = applyHeader(s, h(1, 7, "session.started", togi, "sa"));
  s = applyHeader(s, h(2, 7, "decision.recorded", { kind: "human" }));
  s = applyHeader(s, h(3, 7, "x.y", { kind: "system", component: "adapter:espia" }));
  const out = renderToStaticMarkup(createElement(MesaScreen, { state: s, waiting: 1 }));
  assert.match(out, /<h1>Mesa en vivo<\/h1>/);
  assert.match(out, /en vivo · seq 3/);
  const items = [...out.matchAll(/<li><code class="ident">([^<]+)<\/code><span[^>]*>([^<]+)</g)];
  assert.deepEqual(
    items.map((m) => [m[1], m[2]]),
    [
      ["x.y", "togi · #7 · 09:30:05 · seq 3"],
      ["decision.recorded", "tú · #7 · 09:30:05 · seq 2"],
      ["session.started", "togi · #7 · 09:30:05 · seq 1"],
    ],
  );
  assert.match(out, /<svg[^>]*class="mesa"/);
});

test("sin nada aún, el registro lo dice", () => {
  const out = renderToStaticMarkup(createElement(MesaScreen, { state: EMPTY, waiting: 0 }));
  assert.match(out, /Todavía no ha pasado nada por togi\./);
});

test("⌘1 lleva a las tareas y ⌘2 a la mesa; con otro modificador o tecla, nada", () => {
  const key = (k: string, over = {}) =>
    viewShortcut({
      key: k,
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...over,
    });
  assert.deepEqual(key("1"), PENDING);
  assert.deepEqual(key("2"), { kind: "mesa" });
  assert.equal(key("3"), null);
  assert.equal(key("2", { shiftKey: true }), null);
  assert.equal(key("2", { metaKey: false }), null);
  assert.deepEqual(tasksFor({ kind: "mesa" }, []), []);
});

test("la barra de título lleva Tareas ⌘1 y Mesa en vivo ⌘2, con cuál está pulsada", () => {
  const html = (mesa: boolean) =>
    renderToStaticMarkup(
      createElement(TitleBar, {
        collapsed: false,
        onCollapse: () => {},
        fullscreen: false,
        mesa,
        onMesa: () => {},
      }),
    );
  assert.match(html(true), /aria-pressed="false"[^>]*>Tareas<kbd>⌘1<\/kbd>/);
  assert.match(html(true), /aria-pressed="true"[^>]*>Mesa en vivo<kbd>⌘2<\/kbd>/);
  assert.match(html(false), /aria-pressed="true"[^>]*>Tareas/);
  assert.doesNotMatch(
    renderToStaticMarkup(
      createElement(TitleBar, { collapsed: false, onCollapse: () => {}, fullscreen: false }),
    ),
    /titlebar-views/,
    "sin onMesa, la barra de siempre",
  );
});
