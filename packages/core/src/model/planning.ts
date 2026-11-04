import type { BlobRef } from "./blob.ts";
import type { AgentRole, SessionId } from "./ids.ts";
import type { Reason } from "./task.ts";

export const SESSION_OUTCOMES = ["completed", "failed", "cancelled", "timeout"] as const;
export type SessionOutcome = (typeof SESSION_OUTCOMES)[number];

export const PLAN_CHANGES = ["add", "modify", "delete"] as const;
export type PlanChange = (typeof PLAN_CHANGES)[number];

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
}

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
