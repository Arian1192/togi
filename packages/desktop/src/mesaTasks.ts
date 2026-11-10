import type { TaskState } from "@togi/core";
import type { LogEntry, MesaState } from "./mesa.ts";
import type { TaskRow } from "./TaskList.ts";

// El lateral de la mesa por tarea (la opción C acordada con Arian): una tarjeta por tarea con sus
// pasos y lo último que le ha pasado. Sin DOM: MesaTasks.ts lo pinta. Las tarjetas salen de la lista
// de tareas (su estado) y de las cabeceras que han pasado por togi desde que abriste la mesa.

/**
 * El camino de una tarea en la factoría (ADR-001): los dos «tú» son las dos puertas humanas. Nombres
 * cortos, que caben seis en el ancho del lateral; «código» es donde el builder escribe.
 */
export const STEPS = ["plan", "tú", "código", "gates", "tú", "merge"] as const;
export type Mark = "done" | "now" | "you" | "failed" | "todo";

const AT: Partial<Record<TaskState, number>> = {
  planning: 0,
  plan_review: 1,
  building: 2,
  verifying: 3,
  review: 4,
  merged: STEPS.length,
};

/** Cómo va cada paso; `null` si la tarea no está en el camino (borrador o rechazada). */
export function marks(state: TaskState): Mark[] | null {
  const at = state === "failed" ? 3 : AT[state];
  if (at === undefined) return null;
  return STEPS.map((step, i) => {
    if (i < at) return "done";
    if (i > at) return "todo";
    if (state === "failed") return "failed";
    return step === "tú" ? "you" : "now";
  });
}

const CHIP: Record<TaskState, string> = {
  draft: "borrador",
  planning: "planificando",
  plan_review: "te espera",
  building: "construyendo",
  verifying: "gates",
  review: "te espera",
  merged: "mergeada",
  failed: "falló",
  rejected: "rechazada",
};

export type Tone = "you" | "active" | "quiet";

export interface TaskCard {
  number: number;
  /** `null` si el título se borró. */
  title: string | null;
  tone: Tone;
  chip: string;
  marks: Mark[] | null;
  /** Lo que le ha pasado desde que abriste la mesa, más reciente primero. */
  events: LogEntry[];
}

export interface TaskCards {
  waiting: TaskCard[];
  active: TaskCard[];
  recent: TaskCard[];
}

const toneOf = (state: TaskState): Tone =>
  state === "plan_review" || state === "review"
    ? "you"
    : state === "planning" || state === "building" || state === "verifying"
      ? "active"
      : "quiet";

/**
 * Las tarjetas del lateral: lo que te espera, lo que está en curso y lo que se ha movido hace poco
 * (el resto de tareas no sale). En cada grupo, primero lo que se movió más tarde.
 */
export function taskCards(tasks: readonly TaskRow[], state: MesaState): TaskCards {
  const events = new Map<number, LogEntry[]>();
  for (const e of [...(state.log ?? [])].reverse()) {
    events.set(e.number, [...(events.get(e.number) ?? []), e]);
  }
  const cards = tasks.map(
    (t): TaskCard => ({
      number: t.number,
      title: t.titleErased ? null : t.title,
      tone: toneOf(t.state),
      chip: CHIP[t.state] ?? t.state,
      marks: marks(t.state),
      events: events.get(t.number) ?? [],
    }),
  );
  const latest = (c: TaskCard) => c.events[0]?.seq ?? 0;
  const order = (a: TaskCard, b: TaskCard) => latest(b) - latest(a) || b.number - a.number;
  return {
    waiting: cards.filter((c) => c.tone === "you").sort(order),
    active: cards.filter((c) => c.tone === "active").sort(order),
    recent: cards.filter((c) => c.tone === "quiet" && c.events.length > 0).sort(order),
  };
}

/** El nombre de cada evento, para leerlo; uno que esta versión no conoce va tal cual. */
const EVENT: Record<string, string> = {
  "task.created": "Tarea creada",
  "task.edited": "Tarea editada",
  "task.submitted": "Enviada a planning",
  "task.exploded": "Partida en tareas",
  "task.rejected": "Tarea rechazada",
  "task.completed": "Tarea terminada",
  "session.started": "Sesión abierta",
  "session.ended": "Sesión cerrada",
  "plan.proposed": "Plan propuesto",
  "plan.retry_requested": "Plan pedido otra vez",
  "decision.recorded": "Decisión registrada",
};

export const eventLabel = (name: string): string => EVENT[name] ?? name;

/** Hace cuánto pasó, para lo reciente; lo de hace más de una hora, con su hora. */
export function since(at: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (seconds < 5) return "ahora";
  if (seconds < 60) return `hace ${seconds} s`;
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  return at.slice(11, 16);
}
