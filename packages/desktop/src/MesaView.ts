import { createElement, type ReactNode } from "react";
import { type MesaState, type Pulse, ROLE_LABEL, type Seat } from "./mesa.ts";

// La mesa en vivo (ADR-010 §3): togi en el centro, tú arriba y una plaza por rol y tarea alrededor.
// Cada arista va de alguien a togi: los agentes no se hablan entre sí. El último mensaje de cada
// arista la recorre (CSS, `.mesa-pulse`); su `key` es su seq, así que uno nuevo vuelve a animarse.
// Todo el texto es del vocabulario cerrado de la cabecera, pintado como nodo de texto. Sin JSX.

const W = 800;
const H = 520;
const TOGI = { x: W / 2, y: H / 2 };
const YOU = { x: W / 2, y: 70 };
const RX = 300;
const RY = 175;

type Point = { x: number; y: number };

/** Las plazas en una elipse alrededor de togi, dejando libre el sitio de arriba, que es el tuyo. */
export function seatPoint(index: number, count: number): Point {
  const angle = -Math.PI / 2 + ((index + 1) * 2 * Math.PI) / (count + 1);
  return {
    x: Math.round(TOGI.x + RX * Math.cos(angle)),
    y: Math.round(TOGI.y + RY * Math.sin(angle)),
  };
}

function edge(from: Point, key: string): ReactNode {
  return createElement("line", {
    key,
    className: "mesa-edge",
    x1: from.x,
    y1: from.y,
    x2: TOGI.x,
    y2: TOGI.y,
  });
}

/** El mensaje recorre la arista: de quien lo manda hacia quien lo recibe. */
function pulseLine(p: Pulse, at: Point): ReactNode {
  const [a, b] = p.toward === "togi" ? [at, TOGI] : [TOGI, at];
  return createElement("line", {
    key: `pulse-${p.seq}`,
    className: `mesa-pulse to-${p.toward}`,
    pathLength: 1,
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    "data-event": p.name,
  });
}

function node(at: Point, className: string, title: string, note: string, key: string): ReactNode {
  return createElement(
    "g",
    { key, className: `mesa-node ${className}`, transform: `translate(${at.x} ${at.y})` },
    createElement("rect", { x: -78, y: -26, width: 156, height: 52, rx: 6 }),
    createElement("text", { className: "mesa-title", y: -4, textAnchor: "middle" }, title),
    createElement("text", { className: "mesa-note", y: 15, textAnchor: "middle" }, note),
  );
}

const lastPulse = (pulses: Pulse[], seat: string | null) =>
  pulses.filter((p) => p.seat === seat).at(-1);

export function MesaView({ state, waiting }: { state: MesaState; waiting: number }): ReactNode {
  const seats = state.seats;
  const points = new Map<string, Point>(seats.map((s, i) => [s.key, seatPoint(i, seats.length)]));
  const pulses: ReactNode[] = [];
  const mine = lastPulse(state.pulses, null);
  if (mine) pulses.push(pulseLine(mine, YOU));
  for (const s of seats) {
    const p = lastPulse(state.pulses, s.key);
    const at = points.get(s.key);
    if (p && at) pulses.push(pulseLine(p, at));
  }
  const seatNode = (s: Seat) =>
    node(
      points.get(s.key) ?? TOGI,
      s.active ? "is-active" : "is-done",
      ROLE_LABEL[s.role] ?? s.role,
      `#${s.number} · ${s.active ? "en curso" : "terminado"}`,
      s.key,
    );
  return createElement(
    "svg",
    {
      className: "mesa",
      viewBox: `0 0 ${W} ${H}`,
      role: "img",
      "aria-label": `Mesa en vivo: ${seats.filter((s) => s.active).length} sesiones activas`,
    },
    edge(YOU, "edge-you"),
    seats.map((s) => edge(points.get(s.key) ?? TOGI, `edge-${s.key}`)),
    pulses,
    node(YOU, waiting > 0 ? "is-you is-waiting" : "is-you", "tú", `◆ ${waiting} te esperan`, "you"),
    seats.map(seatNode),
    node(TOGI, "is-togi", "togi", `log · seq ${state.lastSeq}`, "togi"),
  );
}
