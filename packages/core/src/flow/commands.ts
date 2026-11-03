import type { BlobRef } from "../model/blob.ts";
import type { TaskEvent } from "../model/events.ts";
import type { Actor } from "../model/ids.ts";
import type { ReasonCategory, RiskLevel, TaskSource } from "../model/task.ts";

interface Meta {
  actor: Actor;
  at: string;
}

export type TaskChanges = Extract<TaskEvent, { type: "task.edited" }>["payload"];

export type TaskCommand =
  | (Meta & {
      type: "create";
      title: string;
      description: BlobRef | null;
      acceptanceCriteria: BlobRef | null;
      risk: RiskLevel;
      repo: string;
      baseBranch: string;
      source: TaskSource;
    })
  | (Meta & { type: "edit"; changes: TaskChanges })
  | (Meta & { type: "submit" })
  | (Meta & { type: "reject"; reason: { category: ReasonCategory; text: BlobRef | null } });
