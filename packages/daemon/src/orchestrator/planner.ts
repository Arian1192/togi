import type { Plan, SessionStarted, Usage } from "@togi/core";

/** Lo que el orquestador pide: la tarea y la versión del plan que toca producir. */
export interface PlanRequest {
  taskNumber: number;
  planVersion: number;
}

export type PlanOutcome =
  | {
      ok: true;
      plan: Omit<Plan, "planVersion" | "sessionId" | "approach"> & { approach: string };
      usage: Usage;
    }
  | { ok: false; reason: string; usage: Usage };

/** Quién planifica: lo que la sesión registra de él y cómo produce un plan. */
export interface Planner {
  readonly identity: Pick<SessionStarted, "runtime" | "model" | "specialist"> & {
    prompt: string;
    policy: string;
  };
  plan(request: PlanRequest): Promise<PlanOutcome>;
}
