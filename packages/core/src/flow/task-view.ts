import type { BlobRef } from "../model/blob.ts";
import type { TaskEvent } from "../model/events.ts";
import type { RiskLevel, TaskState } from "../model/task.ts";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// El store asigna seq, stream y streamVersion; el decider no los conoce.
export type NewTaskEvent = DistributiveOmit<TaskEvent, "seq" | "stream" | "streamVersion">;

export type TaskView =
  | { exists: false }
  | {
      exists: true;
      state: TaskState;
      title: BlobRef;
      description: BlobRef | null;
      acceptanceCriteria: BlobRef | null;
      risk: RiskLevel;
    };

export const NO_TASK: TaskView = { exists: false };

export function evolve(view: TaskView, event: NewTaskEvent): TaskView {
  switch (event.type) {
    case "task.created": {
      const { title, description, acceptanceCriteria, risk } = event.payload;
      return { exists: true, state: "draft", title, description, acceptanceCriteria, risk };
    }
    case "task.edited":
      return view.exists ? { ...view, ...event.payload } : view;
    case "task.submitted":
      return view.exists ? { ...view, state: "planning" } : view;
    case "task.rejected":
      return view.exists ? { ...view, state: "rejected" } : view;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}
