// El modelo de la mesa en vivo (ADR-010 §3): quién está en la mesa y qué acaba de pasar, a partir de
// la cabecera de cada evento que reenvía Rust (`daemon-event-header`). Solo cabeceras: seq, hora,
// tarea, tipo y quién. Sin DOM: MesaView.ts lo pinta.

/** Quién emitió un evento, sin identificadores (events.rs, `Who`). */
export type Who =
  | { kind: "human" }
  | { kind: "agent"; role: string }
  | { kind: "system"; component: string };

/** La cabecera de un evento de tarea (events.rs, `Header`). */
export interface Header {
  seq: number;
  at: string;
  number: number;
  name: string;
  actor: Who;
  /** La etiqueta opaca de su sesión de agente (events.rs, `SessionTag`), si la tiene. */
  session?: string;
}

/** Los roles con los nombres del ADR-009; un rol que no esté aquí no entra en la mesa. */
export const ROLE_LABEL: Record<string, string> = {
  planner: "Planificador",
  builder: "Constructor",
  reviewer: "Revisor",
  gates: "Gates",
};

/** Una plaza: un rol trabajando en una tarea. Apagada cuando su sesión terminó. */
export interface Seat {
  key: string;
  role: string;
  number: number;
  active: boolean;
  lastSeq: number;
}

/** Un mensaje que acaba de pasar por togi: del humano o de una plaza hacia togi, o de togi a ella. */
export interface Pulse {
  seq: number;
  /** La plaza, o `null` si es el humano. */
  seat: string | null;
  toward: "togi" | "seat";
  name: string;
}

export interface MesaState {
  seats: Seat[];
  pulses: Pulse[];
  lastSeq: number;
}

export const EMPTY: MesaState = { seats: [], pulses: [], lastSeq: 0 };
export const MAX_SEATS = 8;
export const MAX_PULSES = 20;

/**
 * La plaza de un evento y hacia dónde va. Togi abre y cierra cada sesión como `adapter:<rol>`: eso es
 * togi entregándole algo al agente. Lo que emite el agente (un plan) o una pieza de togi que informa
 * (los gates) va hacia togi.
 */
function placeOf(actor: Who): { role: string; toward: Pulse["toward"] } | null {
  if (actor.kind === "agent") return { role: actor.role, toward: "togi" };
  if (actor.kind !== "system") return null;
  const role = actor.component.startsWith("adapter:") ? actor.component.slice(8) : actor.component;
  return { role, toward: actor.component === role ? "togi" : "seat" };
}

/** Aplica una cabecera. Una repetida o anterior no cambia nada; un rol desconocido no entra. */
export function applyHeader(state: MesaState, h: Header): MesaState {
  if (h.seq <= state.lastSeq) return state;
  const place = placeOf(h.actor);
  const base = { ...state, lastSeq: h.seq };
  if (place === null) {
    return { ...base, pulses: keep([...state.pulses, pulse(h, null, "togi")]) };
  }
  if (!Object.hasOwn(ROLE_LABEL, place.role)) return base;
  // Una plaza por sesión: dos agentes del mismo rol en la misma tarea no se pisan.
  const key = h.session ?? `${place.role}#${h.number}`;
  const old = state.seats.find((s) => s.key === key);
  const active =
    h.name === "session.ended"
      ? false
      : h.name === "session.started"
        ? true
        : (old?.active ?? true);
  const seat: Seat = { key, role: place.role, number: h.number, active, lastSeq: h.seq };
  const seats = old
    ? state.seats.map((s) => (s.key === key ? seat : s))
    : trim([...state.seats, seat]);
  return { seats, pulses: keep([...state.pulses, pulse(h, key, place.toward)]), lastSeq: h.seq };
}

const pulse = (h: Header, seat: string | null, toward: Pulse["toward"]): Pulse => ({
  seq: h.seq,
  seat,
  toward,
  name: h.name,
});

const keep = (pulses: Pulse[]) => pulses.slice(-MAX_PULSES);

/**
 * Por encima de MAX_SEATS sobran las apagadas más antiguas. Una activa nunca sale: si no caben, la
 * vista agrupa las que sobran en «+N más».
 */
function trim(seats: Seat[]): Seat[] {
  const out = [...seats];
  while (out.length > MAX_SEATS) {
    const done = out.filter((s) => !s.active);
    if (done.length === 0) break;
    const oldest = done.reduce((a, b) => (b.lastSeq < a.lastSeq ? b : a));
    out.splice(out.indexOf(oldest), 1);
  }
  return out;
}
