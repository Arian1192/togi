import {
  type FailureReason,
  type GateId,
  type GateStatus,
  type SessionOutcome,
  STATE_BRAND,
  stateAfter,
  type TaskState,
} from "@togi/core";
import type { ActivityItem, ActivityUsage } from "./activityApi.ts";
import { whoLabel } from "./mesa.ts";

// La línea de tiempo de Actividad (ADR-010 §3, panel derecho), sin vista: la pintará
// ActivityTimeline.ts. Los cambios de estado salen de `stateAfter` de @togi/core, nunca de una tabla propia (§1).
// Cada sesión es una tarjeta con lo que registra `session.started` y el uso de su `session.ended`;
// cada verificación de togi, otra con los gates de su ciclo.

/** Un cambio de estado; `handoff`, el rol al que togi se la entregó justo después. */
export interface StateLine {
  kind: "state";
  seq: number;
  at: string;
  who: string;
  state: TaskState;
  handoff: string | null;
}

export interface SessionCard {
  kind: "session";
  seq: number;
  at: string;
  role: string;
  specialist: string | null;
  runtime: string | null;
  model: string | null;
  /** Del `session.ended` de la misma sesión; `null` mientras siga abierta. */
  usage: ActivityUsage | null;
  outcome: SessionOutcome | null;
  failureReason: FailureReason | null;
}

export interface GateRow {
  gate: GateId;
  status: GateStatus;
}

/** `passed` a `null`: los gates corren y aún no hay veredicto. */
export interface VerificationCard {
  kind: "verification";
  seq: number;
  at: string;
  cycle: number | null;
  headSha: string | null;
  passed: boolean | null;
  gates: GateRow[];
}

export type FeedEntry = StateLine | SessionCard | VerificationCard;

/** Los movimientos de una tarea (del más antiguo al más reciente) como línea de tiempo. */
export function activityFeed(items: readonly ActivityItem[]): FeedEntry[] {
  const ends = new Map<string, ActivityItem>();
  for (const i of items) if (i.type === "session.ended" && i.sessionId) ends.set(i.sessionId, i);
  const feed: FeedEntry[] = [];
  // Los gates desde la última verificación, con su ciclo.
  let gates: (GateRow & { seq: number; at: string; cycle: number | null })[] = [];
  const rows = (cycle: number | null) =>
    gates.filter((g) => g.cycle === cycle).map(({ gate, status }) => ({ gate, status }));
  for (const i of items) {
    if (i.type === "gate.completed" && i.gate && i.status) {
      // Un gate con `error` se repite en el mismo ciclo: vale el último resultado.
      const cycle = i.cycle ?? null;
      gates = gates.filter((g) => g.gate !== i.gate || g.cycle !== cycle);
      gates.push({ gate: i.gate, status: i.status, seq: i.seq, at: i.at, cycle: i.cycle ?? null });
    }
    if (i.type === "session.started") {
      const role = whoLabel({ kind: "agent", role: i.role ?? "" });
      const last = feed.at(-1);
      if (last?.kind === "state" && last.handoff === null) last.handoff = role;
      const end = i.sessionId ? ends.get(i.sessionId) : undefined;
      feed.push({
        kind: "session",
        seq: i.seq,
        at: i.at,
        role,
        specialist: i.specialist ?? null,
        runtime: i.runtime ?? null,
        model: i.model ?? null,
        usage: end?.usage ?? null,
        outcome: end?.outcome ?? null,
        failureReason: end?.failureReason ?? null,
      });
    }
    if (i.type === "verification.completed") {
      const cycle = i.cycle ?? null;
      const card = { seq: i.seq, at: i.at, cycle, headSha: i.headSha ?? null };
      feed.push({ kind: "verification", ...card, passed: i.passed ?? null, gates: rows(cycle) });
      gates = [];
    }
    // El movimiento lleva el `verdict` y el `passed` que pide `stateAfter`.
    const state = stateAfter(i.type, i);
    // Un tipo que esta versión no conoce no lleva a ningún estado que se pueda pintar.
    if (state !== null && Object.hasOwn(STATE_BRAND, state)) {
      feed.push({
        kind: "state",
        seq: i.seq,
        at: i.at,
        who: whoLabel(i.actor),
        state,
        handoff: null,
      });
    }
  }
  // Los gates que aún no tienen veredicto: la verificación en curso, la de su último ciclo.
  const last = gates.at(-1);
  if (last) {
    const card = { seq: last.seq, at: last.at, cycle: last.cycle, headSha: null };
    feed.push({ kind: "verification", ...card, passed: null, gates: rows(last.cycle) });
  }
  return feed;
}

/** El uso de una sesión, para leerlo: «4 min», «186k tokens», «$0,38». */
export function usageParts(usage: ActivityUsage): string[] {
  const seconds = Math.round(usage.durationMs / 1000);
  const tokens = usage.inputTokens + usage.outputTokens;
  return [
    seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`,
    tokens < 1000 ? `${tokens} tokens` : `${Math.round(tokens / 1000)}k tokens`,
    `$${usage.estimatedCostUsd.toFixed(2).replace(".", ",")}`,
  ];
}
