import { type Node, Position } from "@xyflow/react";
import { MAX_SEATS, type MesaState, type Pulse, ROLE_LABEL, type Seat } from "./mesa.ts";

// La mesa en vivo como grafo de React Flow (ADR-010 §3, pantalla 5 del diseño): togi en el centro, tú
// arriba y las plazas en dos columnas, a izquierda y derecha. Sin DOM: aquí se decide qué nodo va
// dónde y qué dice; React Flow lo pinta. Medidas en píxeles del lienzo del diseño (880 × 660).

export type Point = { x: number; y: number };

const TOGI: Point = { x: 440, y: 330 };
const YOU: Point = { x: 440, y: 72 };
const COLUMN_X = 289; // del centro de togi al centro de cada columna
const ROW_GAP = 200;
export const SIZE = {
  togi: { width: 96, height: 96 },
  you: { width: 160, height: 64 },
  // La plaza lleva encima su tarea (LABEL) y debajo la tarjeta (CARD).
  seat: { width: 222, height: 100 },
} as const;
const LABEL = 24;
const CARD = SIZE.seat.height - LABEL;

/** El centro de la tarjeta de cada plaza: alternan izquierda y derecha, en filas centradas en togi. */
export function seatPoint(index: number, count: number): Point {
  const rows = Math.ceil(count / 2);
  const row = Math.floor(index / 2);
  return {
    x: TOGI.x + (index % 2 === 0 ? -COLUMN_X : COLUMN_X),
    y: TOGI.y + (row - (rows - 1) / 2) * ROW_GAP,
  };
}

/** Por qué lado de la tarjeta sale la arista hacia togi: el que lo mira. */
export const seatSide = (index: number) => (index % 2 === 0 ? "right" : "left");

export type Tone = "is-you" | "is-togi" | "is-active" | "is-done" | "is-more";
/** Un glifo de la tabla de estados del manual de marca: se dibuja como SVG, nunca como carácter. */
export type Glyph = "◐" | "○" | "◆";

export type MesaNodeData = {
  tone: Tone;
  waiting?: boolean;
  /** Encima de la plaza: su tarea, «#13 · Exportar promociones a CSV». */
  label?: string;
  title: string;
  /** A la derecha del título: la hora del último mensaje. */
  meta?: string;
  glyph?: Glyph;
  note: string;
};
export type MesaNode = Node<MesaNodeData, "mesa">;

// Los asideros donde se enganchan las aristas, con el punto exacto (ancho y alto 0). React Flow los lee
// del DOM, salvo al pintar en el servidor (los tests), que usa estos.
type HandleSpec = {
  id: string;
  type: "source" | "target";
  position: Position;
  x: number;
  y: number;
};
const at = (id: string, type: HandleSpec["type"], position: Position, x: number, y: number) => ({
  id,
  type,
  position,
  x,
  y,
  width: 0,
  height: 0,
});
const CARD_Y = LABEL + CARD / 2;
const SEAT_HANDLES: HandleSpec[] = [
  at("left", "source", Position.Left, 0, CARD_Y),
  at("right", "source", Position.Right, SIZE.seat.width, CARD_Y),
];
const TOGI_HANDLES: HandleSpec[] = [
  at("left", "target", Position.Left, 0, SIZE.togi.height / 2),
  at("right", "target", Position.Right, SIZE.togi.width, SIZE.togi.height / 2),
  at("top", "target", Position.Top, SIZE.togi.width / 2, 0),
];
const YOU_HANDLES: HandleSpec[] = [
  at("bottom", "source", Position.Bottom, SIZE.you.width / 2, SIZE.you.height),
];

/** Las plazas que se ven; si no caben todas, las que sobran se agrupan en un último «+N más». */
export function visibleSeats(state: MesaState) {
  const overflow = state.seats.length > MAX_SEATS;
  const seats = overflow ? state.seats.slice(0, MAX_SEATS - 1) : state.seats;
  const hidden = overflow ? state.seats.slice(MAX_SEATS - 1) : [];
  return { seats, hidden, slots: seats.length + (overflow ? 1 : 0) };
}

/** El último mensaje que pasó por alguna de esas plazas (`null` eres tú). */
export const lastPulse = (state: MesaState, keys: (string | null)[]): Pulse | undefined =>
  state.pulses.filter((p) => keys.includes(p.seat)).at(-1);

const hhmm = (iso: string | undefined) => (iso === undefined ? undefined : iso.slice(11, 16));

/**
 * Los nodos de la mesa. `moved` guarda dónde dejaste cada nodo al arrastrarlo; una plaza sembrada
 * como `rol#tarea` que luego adopta su sesión conserva el sitio. `titles` son los títulos de las
 * tareas, que van encima de cada plaza.
 */
export function placeNodes(
  state: MesaState,
  waiting: number,
  moved: ReadonlyMap<string, Point> = new Map(),
  titles: ReadonlyMap<number, string> = new Map(),
): MesaNode[] {
  const { seats, hidden, slots } = visibleSeats(state);
  const taken = new Set(state.seats.map((s) => s.key));
  const placeOf = (s: Seat) => {
    const plain = `${s.role}#${s.number}`;
    if (moved.has(s.key) || taken.has(plain)) return moved.get(s.key);
    // La primera plaza de ese rol y tarea es la que adoptó la sembrada.
    return seats.find((o) => `${o.role}#${o.number}` === plain) === s
      ? moved.get(plain)
      : undefined;
  };
  const timeOf = (seq: number) => state.log?.find((e) => e.seq === seq)?.at;
  const nodes: MesaNode[] = [];
  const put = (
    id: string,
    size: { width: number; height: number },
    center: Point,
    data: MesaNodeData,
    handles: HandleSpec[],
    cardY = size.height / 2,
    placed = moved.get(id),
  ) => {
    const position = placed ?? { x: center.x - size.width / 2, y: center.y - cardY };
    nodes.push({ id, type: "mesa", position, ...size, handles, data });
  };

  const you = { tone: "is-you", title: "tú", glyph: "◆", note: `${waiting} te esperan` } as const;
  put("you", SIZE.you, YOU, { ...you, waiting: waiting > 0 }, YOU_HANDLES);
  seats.forEach((s, i) => {
    const title = titles.get(s.number);
    const data: MesaNodeData = {
      tone: s.active ? "is-active" : "is-done",
      label: title === undefined ? `#${s.number}` : `#${s.number} · ${title}`,
      title: ROLE_LABEL[s.role] ?? s.role,
      meta: hhmm(timeOf(s.lastSeq)) ?? "",
      glyph: s.active ? "◐" : "○",
      note: s.active ? (lastPulse(state, [s.key])?.name ?? "en curso") : "terminado",
    };
    put(s.key, SIZE.seat, seatPoint(i, slots), data, SEAT_HANDLES, CARD_Y, placeOf(s));
  });
  if (hidden.length > 0) {
    const note = `${hidden.filter((s) => s.active).length} en curso`;
    const more: MesaNodeData = {
      tone: "is-more",
      title: `+${hidden.length} más`,
      glyph: "◐",
      note,
    };
    put("more", SIZE.seat, seatPoint(slots - 1, slots), more, SEAT_HANDLES, CARD_Y);
  }
  const togi: MesaNodeData = { tone: "is-togi", title: "togi", note: `log · seq ${state.lastSeq}` };
  put("togi", SIZE.togi, TOGI, togi, TOGI_HANDLES);
  return nodes;
}
