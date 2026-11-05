import { failureReasonProblem, schemaVersionOf } from "../model/domain-event.ts";
import { REASON_CATEGORIES, type TaskState } from "../model/task.ts";
import type { TaskCommand } from "./commands.ts";
import { type DomainError, domainError } from "./errors.ts";
import type { FlowPolicy } from "./policy.ts";
import { type NewTaskEvent, NO_PLANNING, type TaskView } from "./task-view.ts";

const notAllowed = (kind: string) =>
  domainError("actor_not_allowed", `este comando exige actor ${kind}`);

const FINAL_STATES: readonly TaskState[] = ["merged", "failed", "rejected"];

export function decide(
  view: TaskView,
  cmd: TaskCommand,
  policy: FlowPolicy,
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

  const planning = view.planning ?? NO_PLANNING;
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
    case "startSession": {
      if (cmd.actor.kind !== "system") return notAllowed("system");
      if (view.state !== "planning")
        return domainError("invalid_state", "solo se planifica en planning");
      if (cmd.session.role !== "planner") {
        return domainError("invalid_session_role", "en planning solo se inicia una sesión planner");
      }
      if (planning.activeSession) {
        return domainError("session_already_active", "ya hay una sesión activa");
      }
      return [{ ...meta, type: "session.started", payload: cmd.session }];
    }
    case "endSession": {
      if (cmd.actor.kind !== "system") return notAllowed("system");
      if (!planning.activeSession) return domainError("no_active_session", "no hay sesión activa");
      if (planning.activeSession !== cmd.session.sessionId) {
        return domainError("not_session_actor", "no es la sesión activa");
      }
      const failureReason = cmd.session.failureReason ?? null;
      // Misma regla que la lectura de un v2: nunca se genera un evento que el esquema rechace.
      const problem = failureReasonProblem({ outcome: cmd.session.outcome, failureReason });
      if (problem) return domainError("missing_failure_reason", problem);
      return [
        {
          ...meta,
          schemaVersion: schemaVersionOf("session.ended"),
          type: "session.ended",
          payload: { ...cmd.session, failureReason },
        },
      ];
    }
    case "proposePlan": {
      if (cmd.actor.kind !== "agent") return notAllowed("agent");
      if (view.state !== "planning")
        return domainError("invalid_state", "solo se propone en planning");
      if (!planning.activeSession) return domainError("no_active_session", "no hay sesión activa");
      if (cmd.actor.sessionId !== planning.activeSession) {
        return domainError("not_session_actor", "el agente no es el de la sesión activa");
      }
      const plan = {
        ...cmd.plan,
        planVersion: planning.planVersion + 1,
        sessionId: planning.activeSession,
      };
      return [{ ...meta, type: "plan.proposed", payload: plan }];
    }
    case "approvePlan":
    case "requestPlanChanges":
    case "rejectPlan": {
      if (cmd.actor.kind !== "human") return notAllowed("human");
      if (view.state !== "plan_review") {
        return domainError("invalid_state", "solo se decide en plan_review");
      }
      if (cmd.planVersion !== planning.planVersion) {
        return domainError("stale_plan_version", "no es la última versión del plan");
      }
      const base = {
        gate: "plan",
        mode: "binding",
        subject: { planVersion: cmd.planVersion },
      } as const;
      if (cmd.type === "approvePlan") {
        const lines = planning.estimatedLines;
        if (
          !lines ||
          lines.production > policy.maxProductionLines ||
          lines.production + lines.tests > policy.maxTotalLines
        ) {
          return domainError("plan_exceeds_limits", "el plan supera los límites de tamaño");
        }
        return [{ ...meta, type: "decision.recorded", payload: { ...base, verdict: "approve" } }];
      }
      const { category, text } = cmd.reason;
      if (!REASON_CATEGORIES.includes(category) || !text) {
        return domainError("invalid_reason", "el motivo exige categoría válida y texto");
      }
      const verdict =
        cmd.type === "rejectPlan" ? ("reject" as const) : ("request_changes" as const);
      const payload = { ...base, verdict, reason: { category, text } };
      return [{ ...meta, type: "decision.recorded", payload }];
    }
    default: {
      const unhandled: never = cmd;
      return unhandled;
    }
  }
}
