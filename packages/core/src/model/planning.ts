import type { BlobRef } from "./blob.ts";
import type { AgentRole, SessionId } from "./ids.ts";
import type { Reason } from "./task.ts";

export const SESSION_OUTCOMES = ["completed", "failed", "cancelled", "timeout"] as const;
export type SessionOutcome = (typeof SESSION_OUTCOMES)[number];

/**
 * Por qué terminó mal una sesión. Lista cerrada: un código no puede contener datos personales ni
 * secretos, cosa que un texto libre no garantiza. Se amplía, nunca se reutiliza un código.
 */
export const FAILURE_REASONS = [
  "repo_not_registered",
  "timeout",
  "worker_died",
  "invalid_plan",
  "planner_error",
  "planner_failed",
  "trajectory_write_failed",
  "agent_failed",
  "daemon_restarted",
  "max_turns_exceeded",
  "budget_exceeded",
  "sandbox_unavailable",
  "credential_missing",
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

/**
 * Los únicos fallos que togi reintenta solo (U5), fijados en positivo: un trabajador que muere o una
 * trayectoria que no se pudo escribir pueden no repetirse. Cualquier otro motivo queda fuera; en
 * particular `timeout` y `agent_failed`, que reintentados costarían dinero sin que nadie lo pida, y
 * `daemon_restarted`, que ya cubre `recover()`. Añadir un motivo exige cambiar el plan del PR U5.
 */
export const TRANSIENT_FAILURE_REASONS = [
  "worker_died",
  "trajectory_write_failed",
] as const satisfies readonly FailureReason[];

/** Reintentos automáticos por petición de plan; un reintento humano reinicia la cuenta. */
export const MAX_AUTO_RETRIES = 1;

export const isTransientFailure = (reason: FailureReason | null | undefined): boolean =>
  TRANSIENT_FAILURE_REASONS.some((r) => r === reason);

export const PLAN_CHANGES = ["add", "modify", "delete"] as const;
export type PlanChange = (typeof PLAN_CHANGES)[number];

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
}

/** `session.ended` en su forma vigente (schemaVersion 2). */
export interface SessionEnded {
  sessionId: SessionId;
  outcome: SessionOutcome;
  usage: Usage;
  trajectoryEvents: number;
  /** `null` si completó o se canceló; `failed` y `timeout` siempre llevan un código. */
  failureReason: FailureReason | null;
}

/** Lo que pide el comando `endSession`: el motivo es obligatorio si el resultado es failed o timeout. */
export type SessionEndedInput = Omit<SessionEnded, "failureReason"> & {
  failureReason?: FailureReason | null;
};

export interface SessionStarted {
  sessionId: SessionId;
  role: AgentRole;
  /** `null` en planning. */
  cycle: number | null;
  runtime: { id: string; version: string };
  model: string;
  specialist: { id: string; version: number; hash: `sha256:${string}` };
  workspaceId: `wsp_${string}` | null;
  prompt: BlobRef;
  policy: BlobRef;
}

export interface Plan {
  planVersion: number;
  sessionId: SessionId;
  /** Rutas escritas por un agente: son contenido no fiable, el esquema las valida. */
  files: { path: string; change: PlanChange }[];
  newTests: string[];
  approach: BlobRef;
  estimatedLines: { production: number; tests: number };
  /** Commit sobre el que se planificó. */
  baseSha: string;
}

/** Decisión del gate 1; el gate 2 y el modo sombra llegan con sus rebanadas. */
export type PlanDecision = {
  gate: "plan";
  mode: "binding";
  subject: { planVersion: number };
} & ({ verdict: "approve" } | { verdict: "request_changes" | "reject"; reason: Reason });
