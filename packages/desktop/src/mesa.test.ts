import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MesaView, seatPoint } from "./MesaView.ts";
import {
  applyHeader,
  EMPTY,
  type Header,
  MAX_PULSES,
  MAX_SEATS,
  type MesaState,
  type Who,
} from "./mesa.ts";

// La mesa en vivo v1 (ADR-010 §3): el modelo a partir de las cabeceras y su mapa. El cableado con
// `daemon-event-header` llega en la parte siguiente.

const at = "2026-11-10T09:30:00.000Z";
const h = (seq: number, number: number, name: string, actor: Who): Header => ({
  seq,
  at,
  number,
  name,
  actor,
});
const togi = (role: string): Who => ({ kind: "system", component: `adapter:${role}` });
const agent = (role: string): Who => ({ kind: "agent", role });
const human: Who = { kind: "human" };
const play = (...headers: Header[]) => headers.reduce(applyHeader, EMPTY);

test("togi abre la sesión del planificador: aparece su plaza y el mensaje va de togi a ella", () => {
  const s = play(h(1, 7, "session.started", togi("planner")));
  assert.deepEqual(s.seats, [
    { key: "planner#7", role: "planner", number: 7, active: true, lastSeq: 1 },
  ]);
  assert.deepEqual(s.pulses, [
    { seq: 1, seat: "planner#7", toward: "seat", name: "session.started" },
  ]);
});

test("el plan lo manda el agente hacia togi, y al cerrar la sesión la plaza se apaga", () => {
  const s = play(
    h(1, 7, "session.started", togi("planner")),
    h(2, 7, "plan.proposed", agent("planner")),
    h(3, 7, "session.ended", togi("planner")),
  );
  assert.equal(s.seats.length, 1);
  assert.equal(s.seats[0]?.active, false);
  assert.deepEqual(
    s.pulses.map((p) => [p.name, p.toward]),
    [
      ["session.started", "seat"],
      ["plan.proposed", "togi"],
      ["session.ended", "seat"],
    ],
  );
});

test("lo que hace el humano va de tú a togi, sin plaza", () => {
  const s = play(h(1, 7, "decision.recorded", human));
  assert.deepEqual(s.seats, []);
  assert.deepEqual(s.pulses, [{ seq: 1, seat: null, toward: "togi", name: "decision.recorded" }]);
});

test("los gates informan a togi con su propia plaza", () => {
  const s = play(h(1, 4, "gate.completed", { kind: "system", component: "gates" }));
  assert.deepEqual([s.seats[0]?.key, s.pulses[0]?.toward], ["gates#4", "togi"]);
});

test("un evento repetido o anterior no cambia nada, y un rol desconocido no entra pero avanza el seq", () => {
  const s = play(h(5, 7, "session.started", togi("planner")));
  assert.equal(applyHeader(s, h(5, 7, "plan.proposed", agent("planner"))), s);
  assert.equal(applyHeader(s, h(3, 7, "plan.proposed", agent("planner"))), s);
  const odd = applyHeader(s, h(6, 9, "x.y", { kind: "system", component: "adapter:espia" }));
  assert.deepEqual([odd.seats.length, odd.pulses.length, odd.lastSeq], [1, 1, 6]);
});

test("como mucho MAX_SEATS plazas: sobran primero las apagadas más antiguas", () => {
  let s: MesaState = play(
    h(1, 1, "session.started", togi("planner")),
    h(2, 1, "session.ended", togi("planner")),
  );
  for (let n = 2; n <= MAX_SEATS + 1; n++)
    s = applyHeader(s, h(n + 1, n, "session.started", togi("planner")));
  assert.equal(s.seats.length, MAX_SEATS);
  assert.ok(!s.seats.some((x) => x.key === "planner#1"), "sale la apagada");
  assert.ok(s.seats.every((x) => x.active));
});

test("solo se guardan los últimos MAX_PULSES mensajes", () => {
  let s = EMPTY;
  for (let seq = 1; seq <= MAX_PULSES + 5; seq++)
    s = applyHeader(s, h(seq, 1, "task.edited", human));
  assert.equal(s.pulses.length, MAX_PULSES);
  assert.equal(s.pulses[0]?.seq, 6);
});

test("las plazas rodean a togi sin ocupar el sitio de arriba, que es el tuyo", () => {
  for (const count of [1, 3, 8]) {
    for (let i = 0; i < count; i++) {
      const p = seatPoint(i, count);
      assert.ok(!(Math.abs(p.x - 400) < 80 && p.y < 120), `plaza ${i} de ${count} encima de ti`);
    }
  }
});

test("el mapa: togi, tú con lo que te espera, cada plaza con el nombre del ADR-009 y su arista", () => {
  const s = play(
    h(1, 7, "session.started", togi("planner")),
    h(2, 7, "plan.proposed", agent("planner")),
    h(3, 9, "session.started", togi("planner")),
    h(4, 9, "session.ended", togi("planner")),
  );
  const out = renderToStaticMarkup(createElement(MesaView, { state: s, waiting: 2 }));
  assert.match(out, /<svg[^>]*aria-label="Mesa en vivo: 1 sesiones activas"/);
  assert.match(out, />togi</);
  assert.match(out, />log · seq 4</);
  assert.match(out, /mesa-node is-you is-waiting/);
  assert.match(out, />◆ 2 te esperan</);
  assert.equal((out.match(/>Planificador</g) ?? []).length, 2);
  assert.match(out, />#7 · en curso</);
  assert.match(out, /mesa-node is-done[\s\S]*?>#9 · terminado</);
  assert.equal((out.match(/class="mesa-edge"/g) ?? []).length, 3, "tú y las dos plazas");
});

test("el último mensaje de cada arista la recorre, en el sentido en que va", () => {
  const s = play(
    h(1, 7, "session.started", togi("planner")),
    h(2, 7, "plan.proposed", agent("planner")),
  );
  const out = renderToStaticMarkup(createElement(MesaView, { state: s, waiting: 0 }));
  const pulses = out.match(/<line[^>]*class="mesa-pulse[^"]*"[^>]*>/g) ?? [];
  assert.equal(pulses.length, 1, "solo el último de la plaza");
  assert.match(pulses[0] ?? "", /class="mesa-pulse to-togi"/);
  assert.match(pulses[0] ?? "", /pathLength="1"/);
  assert.match(pulses[0] ?? "", /x2="400" y2="260"/, "termina en togi");
  assert.match(pulses[0] ?? "", /data-event="plan.proposed"/);
});
