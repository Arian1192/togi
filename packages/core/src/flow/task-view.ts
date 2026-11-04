import type { BlobRef } from "../model/blob.ts";
import type { TaskEvent } from "../model/events.ts";
import type { SessionId } from "../model/ids.ts";
import type { RiskLevel, TaskState } from "../model/task.ts";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// El store asigna seq, stream y streamVersion; el decider no los conoce.
export type NewTaskEvent = DistributiveOmit<TaskEvent, "seq" | "stream" | "streamVersion">;

export interface PlanningView {
  activeSession: SessionId | null;
  planVersion: number;
  estimatedLines: { production: number; tests: number } | null;
}

export const NO_PLANNING: PlanningView = {
  activeSession: null,
  planVersion: 0,
  estimatedLines: null,
};

export type TaskView =
  | { exists: false }
  | {
      exists: true;
      state: TaskState;
      title: BlobRef;
      description: BlobRef | null;
      acceptanceCriteria: BlobRef | null;
      risk: RiskLevel;
      /** Ausente equivale a NO_PLANNING. */
      planning?: PlanningView;
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
    case "session.started":
      return view.exists
        ? {
            ...view,
            planning: { ...(view.planning ?? NO_PLANNING), activeSession: event.payload.sessionId },
          }
        : view;
    case "session.ended":
      return view.exists
        ? { ...view, planning: { ...(view.planning ?? NO_PLANNING), activeSession: null } }
        : view;
    case "plan.proposed": {
      if (!view.exists) return view;
      const { planVersion, estimatedLines } = event.payload;
      const planning = { ...(view.planning ?? NO_PLANNING), planVersion, estimatedLines };
      return { ...view, state: "plan_review", planning };
    }
    case "decision.recorded": {
      if (!view.exists) return view;
      const next = {
        approve: "building",
        request_changes: "planning",
        reject: "rejected",
      } as const;
      return { ...view, state: next[event.payload.verdict] };
    }
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}
