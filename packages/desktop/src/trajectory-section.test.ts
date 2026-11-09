import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyPage, INITIAL, pageRequest, type TrajectoryState } from "./Trajectory.ts";
import { TrajectorySection } from "./TrajectorySection.ts";

// R6b: la trayectoria va en el cuaderno de la tarea, plegada, y se lee al abrirla. Aquí la vista pura
// y la petición de cada página; el cableado con Tauri, en trajectory-wiring.test.ts.

const css = readFileSync(join(import.meta.dirname, "app.css"), "utf8");

const ready = (over: Partial<TrajectoryState> = {}): TrajectoryState => ({
  ...applyPage(INITIAL, {
    status: "ok",
    events: [
      {
        seq: 1,
        at: "2026-11-09T10:00:00Z",
        kind: "message",
        text: "hola",
        truncated: false,
        erased: false,
      },
    ],
    nextAfter: 1,
    hasMore: false,
    sessionState: "active",
    sessionMark: "2026-11-09T09:00:00Z",
  }),
  ...over,
});
const html = (open: boolean, state: TrajectoryState = INITIAL, busy = false) =>
  renderToStaticMarkup(
    createElement(TrajectorySection, {
      open,
      state,
      busy,
      onToggle: () => {},
      onMore: () => {},
      onRefresh: () => {},
    }),
  );

test("la primera página se pide desde el principio y sin marca; las siguientes, con el cursor y la marca", () => {
  assert.deepEqual(pageRequest(INITIAL), { after: 0, mark: null });
  assert.deepEqual(pageRequest(ready()), { after: 1, mark: "2026-11-09T09:00:00Z" });
});

test("sin sesión, o con un fallo antes de leer nada, se vuelve a pedir desde el principio", () => {
  const empty = applyPage(INITIAL, { status: "no_session" });
  assert.deepEqual(pageRequest(empty), { after: 0, mark: null });
  const failed = applyPage(INITIAL, { status: "unreachable", reason: "no_socket" });
  assert.deepEqual(pageRequest(failed), { after: 0, mark: null });
});

test("un fallo a mitad conserva el cursor, así que reintentar sigue donde iba", () => {
  const failed = applyPage(ready(), { status: "unreachable", reason: "no_socket" });
  assert.deepEqual(pageRequest(failed), { after: 1, mark: "2026-11-09T09:00:00Z" });
});

test("plegada solo lleva el botón para verla, sin pintar la trayectoria", () => {
  const out = html(false);
  assert.match(out, /<button[^>]*aria-expanded="false"[^>]*>Ver la trayectoria<\/button>/);
  assert.match(out, /aria-controls="trajectory-body"/);
  assert.doesNotMatch(out, /class="trajectory"/);
});

test("abierta pinta la trayectoria y el botón la oculta", () => {
  const out = html(true, ready());
  assert.match(out, /<button[^>]*aria-expanded="true"[^>]*>Ocultar la trayectoria<\/button>/);
  assert.match(out, /id="trajectory-body"/);
  assert.match(out, /class="trajectory"/);
  assert.match(out, /hola/);
});

test("una sesión en curso sin más páginas ofrece actualizar; terminada o con más páginas, no", () => {
  assert.match(html(true, ready()), />Actualizar</);
  assert.doesNotMatch(html(true, ready({ sessionState: "ended" })), />Actualizar</);
  assert.doesNotMatch(html(true, ready({ hasMore: true })), />Actualizar</);
  assert.doesNotMatch(html(true, INITIAL), />Actualizar</);
});

test("sin sesión o con un fallo se puede volver a intentar", () => {
  assert.match(html(true, applyPage(INITIAL, { status: "no_session" })), />Volver a leer</);
  const failed = applyPage(INITIAL, { status: "unreachable", reason: "no_socket" });
  assert.match(html(true, failed), />Volver a leer</);
  assert.doesNotMatch(html(true, ready()), />Volver a leer</);
});

test("mientras se lee, los botones de leer no se pueden pulsar", () => {
  assert.match(html(true, ready(), true), /<button[^>]*disabled=""[^>]*>Actualizar</);
});

test("la sección ocupa el ancho del centro", () => {
  const start = css.indexOf("\n.trajectory-section {");
  assert.notEqual(start, -1);
  assert.match(css.slice(start, css.indexOf("}", start)), /align-self: stretch/);
});
