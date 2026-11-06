import { join } from "node:path";
import { claudeAgentSdkDeclaration } from "../../worker/src/adapters/claude-agent-sdk/declaration.ts";
import type { PlannerSource } from "./orchestrator/claude-planner-factory.ts";
import { claudePlanner } from "./orchestrator/claude-planner-factory.ts";
import { PLANNER_ACTIVE, type PlannerStatus } from "./orchestrator/planner-status.ts";

const WORKER = join(import.meta.dirname, "..", "..", "worker");

export interface ProductionPlanner {
  source: PlannerSource | undefined;
  status: PlannerStatus;
}

/**
 * El planificador que usa el daemon real. Solo hay sandbox en macOS: en cualquier otra plataforma el
 * daemon arranca sin planificador (las tareas se quedan en `planning`) y nunca ejecuta un agente sin
 * sandbox. El estado dice cuál de los tres casos es, para que no pase desapercibido.
 */
export function productionPlanner(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined> = {},
  log?: (line: string) => void,
): ProductionPlanner {
  if (platform !== "darwin") {
    return {
      source: undefined,
      status: { state: "unavailable", reason: `sin sandbox en la plataforma ${platform}` },
    };
  }
  // `TOGI_PLANNER=off` lo usan los e2e, que prueban el flujo sin agente.
  if (env.TOGI_PLANNER === "off") {
    return {
      source: undefined,
      status: { state: "disabled", reason: "TOGI_PLANNER=off en el entorno del daemon" },
    };
  }
  return {
    source: claudePlanner({
      workerPackageDir: WORKER,
      declaration: claudeAgentSdkDeclaration,
      ...(log === undefined ? {} : { log }),
    }),
    status: PLANNER_ACTIVE,
  };
}
