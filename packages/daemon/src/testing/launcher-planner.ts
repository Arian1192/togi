import { parsePlanOutput } from "@togi/core";
import type { Planner, PlanOutcome, PlanRequest } from "../orchestrator/planner.ts";
import type { createWorkerLauncher } from "../worker/worker-launcher.ts";

/**
 * Para tests: planifica con el lanzador real y un trabajador falso (`fake-agent-worker.ts`), sin
 * sandbox ni modelo. Cumple el contrato que cumplirá el planificador real: el plan es la respuesta
 * final del agente y el motivo, el del lanzador.
 */
export class LauncherPlanner implements Planner {
  readonly calls: PlanRequest[] = [];
  readonly #launcher: ReturnType<typeof createWorkerLauncher>;
  readonly #mode: (request: PlanRequest) => string;
  readonly #answer: string;

  constructor(
    launcher: ReturnType<typeof createWorkerLauncher>,
    mode: string | ((request: PlanRequest) => string) = "plan",
    answer = JSON.stringify({
      files: [{ path: "src/a.ts", change: "modify" }],
      newTests: ["src/a.test.ts"],
      approach: "enfoque del agente",
      estimatedLines: { production: 10, tests: 20 },
    }),
  ) {
    this.#launcher = launcher;
    this.#mode = typeof mode === "string" ? () => mode : mode;
    this.#answer = answer;
  }

  readonly identity = async (request: PlanRequest) => ({
    runtime: { id: "fake-agent", version: "1" },
    model: request.specialist?.model ?? "fake",
    specialist: { id: "fake", version: 1, hash: "sha256:fake" as const },
    prompt: `prompt de la tarea ${request.taskNumber}`,
    policy: "política de prueba",
  });

  async plan(request: PlanRequest): Promise<PlanOutcome> {
    this.calls.push(request);
    const launch = await this.#launcher.run(
      {
        type: "session",
        sessionId: request.sessionId,
        spec: {
          readPaths: [],
          writeDir: "/tmp",
          allowedDomains: [],
          allowedEnv: [],
          credentials: [],
          timeoutMs: 10_000,
        },
        workspacesRoot: "/tmp",
        runtimePaths: [],
        argv: [this.#mode(request)],
        input: this.#answer,
        credential: null,
      },
      request.taskNumber,
    );
    const { usage, trajectoryEvents } = launch;
    const parsed = launch.outcome === "completed" ? parsePlanOutput(launch.finalText ?? "") : null;
    if (parsed?.ok) {
      return { ok: true, usage, trajectoryEvents, plan: { ...parsed.plan, baseSha: "fake-sha" } };
    }
    const code = launch.failureReason ?? undefined;
    return {
      ok: false,
      reason: parsed ? parsed.error : launch.outcome,
      ...(code ? { code } : {}),
      usage,
      trajectoryEvents,
    };
  }
}
