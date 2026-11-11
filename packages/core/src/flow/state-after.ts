import type { TaskEvent } from "../model/events.ts";
import type { PlanDecision } from "../model/planning.ts";
import type { TaskState } from "../model/task.ts";

// El mapa de estados del flujo, sin vista: a qué estado lleva cada tipo de evento. El escritorio lo
// importa en vez de tener el suyo (ADR-010 §1); state-after.test.ts vigila que diga lo mismo que
// `evolve`.

/** Lo que decide el estado en los eventos que tienen más de uno: el veredicto y si pasó. */
export interface StateHint {
  verdict?: PlanDecision["verdict"];
  passed?: boolean;
}

const BY_VERDICT = {
  approve: "building",
  request_changes: "planning",
  reject: "rejected",
} as const satisfies Record<PlanDecision["verdict"], TaskState>;

/** El estado al que lleva un evento; `null` si no cambia el estado o falta la pista que lo decide. */
export function stateAfter(type: TaskEvent["type"], hint: StateHint): TaskState | null {
  switch (type) {
    case "task.created":
      return "draft";
    case "task.submitted":
      return "planning";
    case "plan.proposed":
      return "plan_review";
    case "decision.recorded":
      return hint.verdict ? BY_VERDICT[hint.verdict] : null;
    case "task.rejected":
      return "rejected";
    case "task.completed":
      return "merged";
    case "build.submitted":
      return "verifying";
    case "verification.completed":
      if (hint.passed === undefined) return null;
      return hint.passed ? "review" : "building";
    case "task.failed":
      return "failed";
    case "task.edited":
    case "session.started":
    case "session.ended":
    case "plan.retry_requested":
    case "workspace.created":
    case "gate.completed":
    case "failure.classified":
    case "workspace.released":
      return null;
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}
