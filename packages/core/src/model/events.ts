import type { BlobRef } from "./blob.ts";
import type { Actor } from "./ids.ts";
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
        title: string;
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
        title: string;
        description: BlobRef | null;
        acceptanceCriteria: BlobRef | null;
      }>
    >
  | E<"task.submitted", Record<string, never>>
  | E<"task.rejected", { reason: Reason }>;
