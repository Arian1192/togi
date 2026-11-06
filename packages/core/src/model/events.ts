import type { BlobRef, DataClass } from "./blob.ts";
import type { Actor, TaskId } from "./ids.ts";
import type { Plan, PlanDecision, SessionEnded, SessionStarted } from "./planning.ts";
import type { Specialist, SpecialistHash } from "./specialist.ts";
import type { Reason, RiskLevel, TaskSource } from "./task.ts";

export interface EventEnvelope<T extends string, P> {
  seq: number;
  stream: string;
  streamVersion: number;
  type: T;
  schemaVersion: number;
  actor: Actor;
  at: string;
  correlationId?: string;
  payload: P;
}

type E<T extends string, P> = EventEnvelope<T, P>;

export type TaskEvent =
  | E<
      "task.created",
      {
        title: BlobRef;
        description: BlobRef | null;
        acceptanceCriteria: BlobRef | null;
        risk: RiskLevel;
        repo: string;
        baseBranch: string;
        source: TaskSource;
      }
    >
  | E<
      "task.edited",
      Partial<{
        title: BlobRef;
        description: BlobRef | null;
        acceptanceCriteria: BlobRef | null;
      }>
    >
  | E<"task.submitted", Record<string, never>>
  | E<"session.started", SessionStarted>
  | E<"session.ended", SessionEnded>
  /** Un humano pide otra sesión de planificación; no cambia el estado de la tarea. */
  | E<"plan.retry_requested", Record<string, never>>
  | E<"plan.proposed", Plan>
  | E<"decision.recorded", PlanDecision>
  | E<"task.rejected", { reason: Reason }>;

/** Stream `admin`: operaciones de administración que no pertenecen a una tarea. */
export type AdminEvent = E<
  "data.erased",
  // Sin contenido: `reason` es un motivo corto sin datos personales.
  { keyId: string; taskId: TaskId; dataClass: DataClass; reason: string }
>;

/** Stream `specialist:<id>`: cada versión publicada, con su contenido completo y su hash. */
export type SpecialistEvent = E<
  "specialist.version_published",
  { specialist: Specialist; hash: SpecialistHash }
>;

export type DomainEvent = TaskEvent | AdminEvent | SpecialistEvent;
