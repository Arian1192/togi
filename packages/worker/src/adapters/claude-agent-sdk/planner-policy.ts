import { ROLE_TOOLS } from "@togi/core";

/** Lectura, búsqueda y listado de ficheros: nada de Bash, escritura ni web (ADR-003, `planning`). */
export const PLANNER_TOOLS = ROLE_TOOLS.planner;

export interface AgentLine {
  kind: "tool_call" | "tool_result" | "message" | "denied" | "usage";
  payload: unknown;
}

/**
 * Hook `PreToolUse`: lo que no está en la lista se deniega y queda en la trayectoria como `denied`.
 * Se ejecuta antes que cualquier regla de permisos, así que vale en cualquier modo.
 */
export function plannerHook(record: (line: AgentLine) => void) {
  return async (input: { hook_event_name: string; tool_name?: string }) => {
    const tool = input.tool_name ?? "";
    if ((PLANNER_TOOLS as readonly string[]).includes(tool)) return {};
    record({ kind: "denied", payload: { tool } });
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason: "herramienta no permitida al planificador",
      },
    };
  };
}
