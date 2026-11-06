import { join } from "node:path";
import type { BlobStore } from "@togi/core";
import type Database from "better-sqlite3";
import { sessionCostCap } from "../config/session-cost.ts";
import type { AgentCredentials } from "../credentials/agent-credential.ts";
import type { SqliteEventStore } from "../store/event-store.ts";
import type { AgentEventStore } from "../trajectory/agent-event-store.ts";
import { createWorkerLauncher } from "../worker/worker-launcher.ts";
import { ClaudePlanner, type ClaudePlannerDeps } from "./claude-planner.ts";
import type { Planner } from "./planner.ts";
import { claudeRuntime } from "./runtime-paths.ts";

/** Lo que el daemon tiene a mano al arrancar y un planificador puede necesitar. */
export interface PlannerContext {
  db: Database.Database;
  home: string;
  store: SqliteEventStore;
  readText: (ref: Parameters<BlobStore["get"]>[0]) => Promise<string>;
  agentEvents: AgentEventStore;
  credentials: AgentCredentials;
  /** Valores que nunca deben llegar a un diagnóstico, como el token de togi. */
  scrub: readonly string[];
  env: Record<string, string | undefined>;
}

/** Un `Planner` o la forma de construirlo con lo que el daemon tiene al arrancar. */
export type PlannerSource = Planner | ((context: PlannerContext) => Planner);

export interface ClaudePlannerOptions {
  /** `packages/worker`: de ahí salen el trabajador, el adaptador y el SDK. */
  workerPackageDir: string;
  declaration: ClaudePlannerDeps["declaration"];
  log?: (line: string) => void;
}

/**
 * Construye el planificador real al arrancar. Valida el tope de coste (un valor inválido lanza y el
 * daemon no arranca) y deja constancia de cuál usa.
 */
export function claudePlanner({
  workerPackageDir,
  declaration,
  log = (line) => console.error(line),
}: ClaudePlannerOptions): (context: PlannerContext) => ClaudePlanner {
  return (context) => {
    const cap = sessionCostCap(context.env);
    const runtime = claudeRuntime(workerPackageDir);
    log(
      `planificador: tope de coste por sesión ${cap.usd} USD (${cap.source === "env" ? "TOGI_MAX_SESSION_COST_USD" : "por defecto"})`,
    );
    return new ClaudePlanner({
      db: context.db,
      store: context.store,
      readText: context.readText,
      home: context.home,
      credentials: context.credentials,
      launcher: createWorkerLauncher({
        agentEvents: context.agentEvents,
        workerEntry: join(workerPackageDir, "src", "main.ts"),
        scrub: context.scrub,
      }),
      declaration,
      agentEntry: join(workerPackageDir, "src", "adapters", "claude-agent-sdk", "main.ts"),
      runtime: { id: "claude-agent-sdk", version: runtime.sdkVersion },
      runtimePaths: runtime.paths,
      executable: runtime.executable,
      maxCostUsd: cap.usd,
    });
  };
}
