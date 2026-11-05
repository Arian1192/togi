import type { FailureReason, Plan, SessionId, SessionStarted, Specialist, Usage } from "@togi/core";

/** Lo que el orquestador pide: la tarea y la versión del plan que toca producir. */
export interface PlanRequest {
  taskNumber: number;
  planVersion: number;
  /** La sesión que el orquestador abre (o ha abierto) para esta petición. */
  sessionId: SessionId;
  /** El especialista que ocupa la etapa, según el flujo. Sin flujo, el planificador usa el suyo. */
  specialist?: Specialist | undefined;
}

export type PlanOutcome =
  | {
      ok: true;
      plan: Omit<Plan, "planVersion" | "sessionId" | "approach"> & { approach: string };
      usage: Usage;
      /** Eventos de trayectoria que escribió la sesión; sin dato, 0. */
      trajectoryEvents?: number;
    }
  /** `reason` es texto para el log del daemon; `code` es lo que queda en `session.ended`. */
  | {
      ok: false;
      reason: string;
      code?: FailureReason;
      usage: Usage;
      trajectoryEvents?: number;
    };

/** Lo que `session.started` registra del planificador. */
export type PlannerIdentity = Pick<SessionStarted, "runtime" | "model" | "specialist"> & {
  prompt: string;
  policy: string;
};

/** Quién planifica: lo que la sesión registra de él y cómo produce un plan. */
export interface Planner {
  /** Fija, o se calcula por petición: el prompt depende de la tarea y no existe antes de ella. */
  readonly identity: PlannerIdentity | ((request: PlanRequest) => Promise<PlannerIdentity>);
  plan(request: PlanRequest): Promise<PlanOutcome>;
}
