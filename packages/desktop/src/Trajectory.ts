import { createElement, type ReactNode } from "react";

// La trayectoria de la sesión de una tarea (ADR-010 §3): lo que hizo el agente, evento a evento. El
// texto lo escribe el agente, así que se pinta siempre como nodo de texto de React, nunca como HTML
// (ADR-010 §8). Aquí solo hay modelo y vista, sin invocar nada: el comando `read_trajectory` y el
// cursor los lleva `TrajectoryPane`. Sin JSX a propósito: los tests corren con `node --test`.

/** Los tipos de evento del daemon, más `oversized`: el que no cupo en el cuerpo máximo (trajectory.rs). */
export type EventKind = "message" | "tool_call" | "tool_result" | "denied" | "usage" | "oversized";

/** Un evento tal y como lo devuelve `read_trajectory`. */
export interface TrajectoryEvent {
  seq: number;
  at: string;
  kind: EventKind;
  text: string;
  /** El texto se recortó a 500 caracteres. */
  truncated: boolean;
  erased: boolean;
}

/** Lo que devuelve `read_trajectory`: los motivos de `unreachable` son cerrados. */
export type TrajectoryResult =
  | {
      status: "ok";
      events: TrajectoryEvent[];
      nextAfter: number;
      hasMore: boolean;
      sessionState: "active" | "ended";
      sessionMark: string;
    }
  | { status: "no_session" }
  | { status: "session_changed" }
  | { status: "unreachable"; reason: string };

export interface TrajectoryState {
  phase: "loading" | "ready" | "empty" | "error";
  events: TrajectoryEvent[];
  /** El cursor: el `seq` del último evento leído. */
  after: number;
  /** La sesión de `after`; si cambia, el cursor ya no vale. */
  mark: string | null;
  hasMore: boolean;
  sessionState: "active" | "ended" | null;
  reason: string | null;
}

export const INITIAL: TrajectoryState = {
  phase: "loading",
  events: [],
  after: 0,
  mark: null,
  hasMore: false,
  sessionState: null,
  reason: null,
};

/** Cuántos eventos se guardan: una sesión larga no puede llenar la memoria de la ventana. */
export const MAX_EVENTS = 500;

export const KIND_LABEL: Record<EventKind, string> = {
  message: "Mensaje",
  tool_call: "Herramienta",
  tool_result: "Resultado",
  denied: "Denegada",
  usage: "Uso",
  oversized: "Demasiado grande",
};

/**
 * Junta una página con lo ya leído. Un evento repetido no se vuelve a añadir; con otra sesión se
 * descarta todo y se vuelve a empezar; un fallo conserva lo leído y guarda el motivo.
 */
export function applyPage(state: TrajectoryState, result: TrajectoryResult): TrajectoryState {
  switch (result.status) {
    case "no_session":
      return { ...INITIAL, phase: "empty" };
    case "session_changed":
      return INITIAL;
    case "unreachable":
      return { ...state, phase: "error", reason: result.reason };
    case "ok": {
      const last = state.events.at(-1)?.seq ?? 0;
      const merged = [...state.events, ...result.events.filter((e) => e.seq > last)];
      const capped = merged.length >= MAX_EVENTS && (merged.length > MAX_EVENTS || result.hasMore);
      return {
        phase: "ready",
        events: merged.slice(0, MAX_EVENTS),
        after: result.nextAfter,
        mark: result.sessionMark,
        hasMore: result.hasMore && !capped,
        sessionState: result.sessionState,
        reason: null,
      };
    }
  }
}

function text(event: TrajectoryEvent): ReactNode {
  if (event.erased) return createElement("span", { className: "muted" }, "[borrado]");
  if (event.kind === "oversized") {
    return createElement(
      "span",
      { className: "muted" },
      "Este evento es demasiado grande para mostrarse.",
    );
  }
  return event.truncated ? `${event.text}…` : event.text;
}

function Row({ event }: { event: TrajectoryEvent }): ReactNode {
  return createElement(
    "li",
    { className: "trajectory-row", title: event.at },
    createElement("span", { className: "trajectory-seq" }, `#${event.seq}`),
    createElement(
      "span",
      { className: event.kind === "denied" ? "trajectory-kind tone-human" : "trajectory-kind" },
      KIND_LABEL[event.kind],
    ),
    createElement("span", { className: "trajectory-text" }, text(event)),
  );
}

export function TrajectoryView({
  state,
  busy = false,
  onMore,
}: {
  state: TrajectoryState;
  busy?: boolean;
  onMore: () => void;
}): ReactNode {
  const session = { active: " · en curso", ended: " · terminada" }[state.sessionState ?? "ended"];
  const title = `La trayectoria${state.sessionState === null ? "" : session}`;
  let note: ReactNode = null;
  if (state.phase === "loading") note = "Leyendo la trayectoria…";
  else if (state.phase === "empty")
    note = "Todavía no hay ninguna sesión de agente para esta tarea.";
  else if (state.phase === "error") note = `No se pudo leer la trayectoria (${state.reason}).`;
  else if (state.events.length === 0) note = "La sesión aún no ha registrado nada.";
  return createElement(
    "section",
    { className: "trajectory" },
    createElement("h2", null, title),
    note === null ? null : createElement("p", { className: "muted" }, note),
    state.events.length === 0
      ? null
      : createElement(
          "ol",
          { className: "trajectory-rows" },
          state.events.map((event) => createElement(Row, { key: event.seq, event })),
        ),
    state.events.length >= MAX_EVENTS
      ? createElement(
          "p",
          { className: "muted" },
          `Se muestran los primeros ${MAX_EVENTS} eventos.`,
        )
      : null,
    state.hasMore
      ? createElement(
          "button",
          { type: "button", className: "btn btn-secondary", disabled: busy, onClick: onMore },
          "Cargar más",
        )
      : null,
  );
}
