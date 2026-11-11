import { type BuildingView, NO_BUILDING } from "../model/building.ts";
import { payloadProblem } from "../model/domain-event.ts";
import { isTransientFailure } from "../model/planning.ts";
import type { TaskCommand } from "./commands.ts";
import { type DomainError, domainError } from "./errors.ts";
import { type NewTaskEvent, NO_PLANNING, type TaskView } from "./task-view.ts";

// La construcción (ADR-011) y la sesión del builder que no entrega (enmienda del ADR-004, 11 de
// noviembre). Solo actúa togi: el builder trabaja en la copia y togi abre, cierra y entrega.

type BuildCommand = Extract<
  TaskCommand,
  { type: "createWorkspace" | "startSession" | "submitBuild" }
>;
type Meta = Pick<NewTaskEvent, "schemaVersion" | "actor" | "at">;

/** La primera sesión del ciclo, o el único reintento tras una caída pasajera. */
const mayStart = (b: BuildingView): boolean => {
  const attempts = b.attempts ?? 0;
  if (attempts === 0) return true;
  return attempts === 1 && b.lastOutcome === "failed" && isTransientFailure(b.lastFailure);
};

/** Se entrega lo que haya si la última sesión del ciclo terminó o agotó el tiempo; tras una caída, no. */
// El daemon escribe el tope de tiempo como `failed` con motivo `timeout`; se aceptan las dos formas.
const mayDeliver = (b: BuildingView): boolean =>
  b.lastOutcome === "completed" || b.lastOutcome === "timeout" || b.lastFailure === "timeout";

/** El store no valida al escribir: un evento que el esquema rechace no se emite. */
const checked = (event: NewTaskEvent): NewTaskEvent[] | DomainError => {
  const problem = payloadProblem(event.type, event.payload);
  return problem ? domainError("invalid_payload", problem) : [event];
};

export function decideBuilding(
  view: Extract<TaskView, { exists: true }>,
  cmd: BuildCommand,
  meta: Meta,
): NewTaskEvent[] | DomainError {
  if (cmd.actor.kind !== "system") {
    return domainError("actor_not_allowed", "este comando exige actor system");
  }
  if (view.state !== "building")
    return domainError("invalid_state", "solo se construye en building");
  const b = view.building ?? NO_BUILDING;
  const busy = Boolean(b.activeSession || (view.planning ?? NO_PLANNING).activeSession);
  const stale = (cycle: number | null) =>
    cycle === b.cycle ? null : domainError("stale_cycle", `el ciclo en curso es el ${b.cycle}`);
  const active = () => domainError("session_already_active", "ya hay una sesión activa");

  switch (cmd.type) {
    case "createWorkspace":
      if (b.workspaceId) {
        return domainError("workspace_already_exists", "la tarea ya tiene copia de trabajo");
      }
      return checked({ ...meta, type: "workspace.created", payload: cmd.workspace });
    case "startSession": {
      const s = cmd.session;
      if (!b.workspaceId || s.workspaceId !== b.workspaceId) {
        return domainError(
          "workspace_mismatch",
          "la sesión no va en la copia de trabajo de la tarea",
        );
      }
      const error = stale(s.cycle) ?? (busy ? active() : null);
      if (error) return error;
      if (!mayStart(b)) {
        return domainError(
          "actor_not_allowed",
          "el actor system solo reintenta una caída pasajera, una vez por ciclo",
        );
      }
      return [{ ...meta, type: "session.started", payload: s }];
    }
    case "submitBuild": {
      const error = stale(cmd.cycle) ?? (busy ? active() : null);
      if (error) return error;
      if (!mayDeliver(b)) {
        return domainError(
          "invalid_state",
          "solo se entrega tras una sesión de este ciclo que terminó o agotó el tiempo",
        );
      }
      const payload = { cycle: cmd.cycle, headSha: cmd.headSha };
      return checked({ ...meta, type: "build.submitted", payload });
    }
    default: {
      const unhandled: never = cmd;
      return unhandled;
    }
  }
}
