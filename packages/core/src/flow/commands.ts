import type { BlobRef } from "../model/blob.ts";
import type { TaskEvent } from "../model/events.ts";
import type { Actor } from "../model/ids.ts";
import type { Plan, SessionStarted } from "../model/planning.ts";
import type { ReasonCategory, RiskLevel, TaskSource } from "../model/task.ts";

interface Meta {
  actor: Actor;
  at: string;
}

export type TaskChanges = Extract<TaskEvent, { type: "task.edited" }>["payload"];

export type TaskCommand =
  | (Meta & {
      type: "create";
      title: BlobRef;
      description: BlobRef | null;
      acceptanceCriteria: BlobRef | null;
      risk: RiskLevel;
      repo: string;
      baseBranch: string;
      source: TaskSource;
    })
  | (Meta & { type: "edit"; changes: TaskChanges })
  | (Meta & { type: "submit" })
  | (Meta & { type: "reject"; reason: { category: ReasonCategory; text: BlobRef | null } })
  | (Meta & { type: "startSession"; session: SessionStarted })
  | (Meta & {
      type: "endSession";
      session: Extract<TaskEvent, { type: "session.ended" }>["payload"];
    })
  | (Meta & { type: "proposePlan"; plan: Omit<Plan, "planVersion" | "sessionId"> })
  | (Meta & { type: "approvePlan"; planVersion: number })
  | (Meta & {
      type: "requestPlanChanges" | "rejectPlan";
      planVersion: number;
      reason: { category: ReasonCategory; text: BlobRef | null };
    });
