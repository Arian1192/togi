import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MesaView } from "./MesaView.ts";
import { applyHeader, EMPTY, type Header, MAX_SEATS, type Who } from "./mesa.ts";

// Varios agentes a la vez: una plaza por sesión (la etiqueta opaca de Rust) y ninguna plaza activa
// sale de la mesa por falta de sitio.

const togi: Who = { kind: "system", component: "adapter:planner" };
const agent: Who = { kind: "agent", role: "planner" };
const h = (seq: number, number: number, name: string, actor: Who, session?: string): Header => ({
  seq,
  at: "2026-11-10T09:30:00.000Z",
  number,
  name,
  actor,
  ...(session === undefined ? {} : { session }),
});
const play = (...headers: Header[]) => headers.reduce(applyHeader, EMPTY);

test("dos agentes del mismo rol en la misma tarea tienen cada uno su plaza", () => {
  const s = play(
    h(1, 7, "session.started", togi, "sa"),
    h(2, 7, "session.started", togi, "sb"),
    h(3, 7, "plan.proposed", agent, "sa"),
  );
  assert.deepEqual(
    s.seats.map((x) => [x.key, x.number, x.active]),
    [
      ["sa", 7, true],
      ["sb", 7, true],
    ],
  );
  assert.equal(s.pulses.at(-1)?.seat, "sa", "el plan es de la sesión que lo mandó");
});

test("cuando una termina, la otra sigue en curso", () => {
  const s = play(
    h(1, 7, "session.started", togi, "sa"),
    h(2, 7, "session.started", togi, "sb"),
    h(3, 7, "session.ended", togi, "sb"),
  );
  assert.deepEqual(
    s.seats.map((x) => [x.key, x.active]),
    [
      ["sa", true],
      ["sb", false],
    ],
  );
});

test("con diez agentes en curso ninguno sale de la mesa", () => {
  let s = EMPTY;
  for (let i = 1; i <= 10; i++) s = applyHeader(s, h(i, i, "session.started", togi, `s${i}`));
  assert.equal(s.seats.length, 10);
  assert.ok(s.seats.every((x) => x.active));
});

test("si no caben, las que sobran se agrupan en «+N más», con su arista y sus mensajes", () => {
  let s = EMPTY;
  for (let i = 1; i <= 10; i++) s = applyHeader(s, h(i, i, "session.started", togi, `s${i}`));
  s = applyHeader(s, h(11, 10, "plan.proposed", agent, "s10"));
  const out = renderToStaticMarkup(createElement(MesaView, { state: s, waiting: 0 }));
  assert.equal((out.match(/>Planificador</g) ?? []).length, MAX_SEATS - 1);
  assert.match(out, /mesa-node is-more/);
  assert.match(out, />\+3 más</);
  assert.match(out, />3 en curso</);
  assert.equal((out.match(/class="mesa-edge"/g) ?? []).length, MAX_SEATS + 1, "tú, 7 plazas y +N");
  assert.match(out, /Mesa en vivo: 10 sesiones activas/);
  assert.match(
    out,
    /data-event="plan.proposed"/,
    "el mensaje de una plaza escondida también se ve",
  );
});
