import { REASON_CATEGORIES, type TaskState } from "../model/task.ts";
import type { TaskCommand } from "./commands.ts";
import { type DomainError, domainError } from "./errors.ts";
import type { FlowPolicy } from "./policy.ts";
import type { NewTaskEvent, TaskView } from "./task-view.ts";

const FINAL_STATES: readonly TaskState[] = ["merged", "failed", "rejected"];

export function decide(
  view: TaskView,
  cmd: TaskCommand,
  _policy: FlowPolicy,
): NewTaskEvent[] | DomainError {
  const meta = { schemaVersion: 1, actor: cmd.actor, at: cmd.at };

  if (cmd.type === "create") {
    if (view.exists) return domainError("task_already_exists", "la tarea ya existe");
    const { title, description, acceptanceCriteria, risk, repo, baseBranch, source } = cmd;
    const payload = { title, description, acceptanceCriteria, risk, repo, baseBranch, source };
    return [{ ...meta, type: "task.created", payload }];
  }

  if (!view.exists) return domainError("task_not_found", "la tarea no existe");
  if (FINAL_STATES.includes(view.state)) {
    return domainError("task_final", `la tarea está en ${view.state}, estado final`);
  }

  switch (cmd.type) {
    case "edit": {
      if (view.state !== "draft") return domainError("invalid_state", "solo se edita en draft");
      if (Object.values(cmd.changes).every((v) => v === undefined)) {
        return domainError("empty_edit", "la edición no cambia nada");
      }
      return [{ ...meta, type: "task.edited", payload: cmd.changes }];
    }
    case "submit": {
      if (view.state !== "draft") return domainError("invalid_state", "solo se envía desde draft");
      if (view.acceptanceCriteria === null) {
        return domainError("missing_acceptance_criteria", "falta el criterio de aceptación");
      }
      if (!view.risk) return domainError("missing_risk", "falta el nivel de riesgo");
      return [{ ...meta, type: "task.submitted", payload: {} }];
    }
    case "reject": {
      const { category, text } = cmd.reason;
      if (!REASON_CATEGORIES.includes(category) || !text) {
        return domainError("invalid_reason", "el motivo exige categoría válida y texto");
      }
      return [{ ...meta, type: "task.rejected", payload: { reason: { category, text } } }];
    }
    default: {
      const unhandled: never = cmd;
      return unhandled;
    }
  }
}
