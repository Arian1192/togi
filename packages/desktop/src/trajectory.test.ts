import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  applyPage,
  INITIAL,
  KIND_LABEL,
  MAX_EVENTS,
  type TrajectoryEvent,
  type TrajectoryResult,
  type TrajectoryState,
  TrajectoryView,
} from "./Trajectory.ts";

const css = readFileSync(join(import.meta.dirname, "app.css"), "utf8");

const ev = (seq: number, over: Partial<TrajectoryEvent> = {}): TrajectoryEvent => ({
  seq,
  at: "2026-11-09T10:00:00.000Z",
  kind: "message",
  text: `evento ${seq}`,
  truncated: false,
  erased: false,
  ...over,
});
const page = (
  events: TrajectoryEvent[],
  over: Partial<Extract<TrajectoryResult, { status: "ok" }>> = {},
): TrajectoryResult => ({
  status: "ok",
  events,
  nextAfter: events.at(-1)?.seq ?? 0,
  hasMore: false,
  sessionState: "active",
  sessionMark: "2026-11-09T09:00:00.000Z",
  ...over,
});
const html = (state: TrajectoryState, onMore = () => {}) =>
  renderToStaticMarkup(createElement(TrajectoryView, { state, onMore }));

test("se empieza leyendo, sin eventos ni cursor", () => {
  assert.deepEqual(INITIAL, {
    phase: "loading",
    events: [],
    after: 0,
    mark: null,
    hasMore: false,
    sessionState: null,
    reason: null,
  });
});

test("una página con eventos se añade, avanza el cursor y guarda la marca de la sesión", () => {
  const first = applyPage(INITIAL, page([ev(1), ev(2)], { hasMore: true }));
  assert.equal(first.phase, "ready");
  assert.deepEqual(
    first.events.map((e) => e.seq),
    [1, 2],
  );
  assert.equal(first.after, 2);
  assert.equal(first.mark, "2026-11-09T09:00:00.000Z");
  assert.equal(first.hasMore, true);
  const next = applyPage(first, page([ev(3)]));
  assert.deepEqual(
    next.events.map((e) => e.seq),
    [1, 2, 3],
  );
  assert.equal(next.after, 3);
  assert.equal(next.hasMore, false);
});

test("un evento ya visto no se repite aunque llegue otra vez", () => {
  const state = applyPage(INITIAL, page([ev(1), ev(2)]));
  const again = applyPage(state, page([ev(2), ev(3)]));
  assert.deepEqual(
    again.events.map((e) => e.seq),
    [1, 2, 3],
  );
});

test("una sesión sin eventos todavía está lista y vacía, y sin sesión es otro estado", () => {
  assert.equal(applyPage(INITIAL, page([])).phase, "ready");
  const none = applyPage(INITIAL, { status: "no_session" });
  assert.equal(none.phase, "empty");
  assert.deepEqual(none.events, []);
});

test("si cambia la sesión se descarta lo leído y se vuelve a empezar", () => {
  const read = applyPage(INITIAL, page([ev(1), ev(2)]));
  const changed = applyPage(read, { status: "session_changed" });
  assert.deepEqual(changed, INITIAL);
});

test("un fallo guarda el motivo cerrado y no tira lo ya leído", () => {
  const read = applyPage(INITIAL, page([ev(1)], { hasMore: true }));
  const failed = applyPage(read, { status: "unreachable", reason: "no_socket" });
  assert.equal(failed.phase, "error");
  assert.equal(failed.reason, "no_socket");
  assert.deepEqual(
    failed.events.map((e) => e.seq),
    [1],
  );
});

test("no se guardan más de MAX_EVENTS: más allá no se ofrece cargar más", () => {
  const many = Array.from({ length: MAX_EVENTS + 5 }, (_, i) => ev(i + 1));
  const state = applyPage(INITIAL, page(many, { hasMore: true }));
  assert.equal(state.events.length, MAX_EVENTS);
  assert.equal(state.hasMore, false);
  assert.match(html(state), new RegExp(`primeros ${MAX_EVENTS} eventos`));
});

test("cada tipo de evento tiene su nombre en español", () => {
  assert.deepEqual(KIND_LABEL, {
    message: "Mensaje",
    tool_call: "Herramienta",
    tool_result: "Resultado",
    denied: "Denegada",
    usage: "Uso",
    oversized: "Demasiado grande",
  });
});

test("la vista dice qué pasa: leyendo, sin sesión y error", () => {
  assert.match(html(INITIAL), /Leyendo la trayectoria/);
  assert.match(html(applyPage(INITIAL, { status: "no_session" })), /ninguna sesión de agente/);
  const err = html(applyPage(INITIAL, { status: "unreachable", reason: "bad_response" }));
  assert.match(err, /No se pudo leer la trayectoria \(bad_response\)/);
});

test("las filas llevan el número, el tipo y el texto; el estado de la sesión va en el título", () => {
  const out = html(applyPage(INITIAL, page([ev(1, { kind: "tool_call", text: "Bash" })])));
  assert.match(out, /<h2[^>]*>La trayectoria[^<]*en curso/);
  assert.match(out, /#1</);
  assert.match(out, /Herramienta/);
  assert.match(out, /Bash/);
  const ended = html(applyPage(INITIAL, page([ev(1)], { sessionState: "ended" })));
  assert.match(ended, /terminada/);
});

test("lo denegado destaca con el color human; el resto no", () => {
  const out = html(applyPage(INITIAL, page([ev(1, { kind: "denied" }), ev(2, { kind: "usage" })])));
  const denied = out.slice(out.indexOf("Denegada") - 80, out.indexOf("Denegada"));
  assert.match(denied, /tone-human/);
  const usage = out.slice(out.indexOf("Uso") - 80, out.indexOf("Uso"));
  assert.doesNotMatch(usage, /tone-human/);
});

test("un texto borrado, recortado o demasiado grande lo dice sin inventar nada", () => {
  const out = html(
    applyPage(
      INITIAL,
      page([
        ev(1, { erased: true, text: "" }),
        ev(2, { truncated: true, text: "inicio" }),
        ev(3, { kind: "oversized", text: "" }),
      ]),
    ),
  );
  assert.match(out, /\[borrado\]/);
  assert.match(out, /inicio…/);
  assert.match(out, /demasiado grande para mostrarse/);
});

test("el texto del agente se pinta como texto, nunca como HTML", () => {
  const out = html(applyPage(INITIAL, page([ev(1, { text: "<img src=x onerror=alert(1)>" })])));
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /&lt;img/);
});

test("«Cargar más» solo si hay más, y se desactiva mientras se lee", () => {
  const more = applyPage(INITIAL, page([ev(1)], { hasMore: true }));
  assert.match(html(more), /<button[^>]*>Cargar más<\/button>/);
  assert.doesNotMatch(html(more), /disabled/);
  const busy = renderToStaticMarkup(
    createElement(TrajectoryView, { state: more, busy: true, onMore: () => {} }),
  );
  assert.match(busy, /<button[^>]*disabled[^>]*>Cargar más/);
  assert.doesNotMatch(html(applyPage(INITIAL, page([ev(1)]))), /Cargar más/);
});

test("pulsar «Cargar más» avisa", () => {
  let calls = 0;
  const more = applyPage(INITIAL, page([ev(1)], { hasMore: true }));
  const tree = TrajectoryView({ state: more, onMore: () => calls++ });
  const find = (node: unknown): { props: { onClick?: () => void } } | undefined => {
    if (Array.isArray(node)) return node.map(find).find(Boolean);
    if (typeof node !== "object" || node === null) return undefined;
    const el = node as { type?: unknown; props?: { children?: unknown; onClick?: () => void } };
    if (el.type === "button") return el as { props: { onClick?: () => void } };
    return find(el.props?.children);
  };
  find(tree)?.props.onClick?.();
  assert.equal(calls, 1);
});

test("«Cargar más» es un botón compacto a la izquierda, no una barra de ancho completo", () => {
  assert.match(css, /\.trajectory \.btn \{[^}]*align-self: flex-start/);
});

test("la trayectoria tiene estilo propio con los tokens, en mono, y no usa glifos de estado", () => {
  assert.match(css, /\.trajectory-row \{[^}]*var\(--/);
  assert.match(css, /\.trajectory-seq[^{]*\{[^}]*var\(--font-mono\)/);
  assert.doesNotMatch(KIND_LABEL.message + KIND_LABEL.denied, /[◆◐◑○●✕]/);
});
