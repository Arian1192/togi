import type { Planner, PlanOutcome, PlanRequest } from "../orchestrator/planner.ts";

const usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, durationMs: 0 };

/** Planificador determinista para tests: nunca se activa fuera de ellos. */
export class FakePlanner implements Planner {
  readonly identity = {
    runtime: { id: "fake", version: "1" },
    model: "fake",
    specialist: { id: "fake-planner", version: 1, hash: "sha256:fake-planner@1" as const },
    prompt: "prompt del planificador falso",
    policy: "política del planificador falso",
  };
  readonly calls: PlanRequest[] = [];
  maxConcurrent = 0;
  #running = 0;

  readonly #fails: (request: PlanRequest) => boolean;

  constructor(fails: (request: PlanRequest) => boolean = () => false) {
    this.#fails = fails;
  }

  async plan(request: PlanRequest): Promise<PlanOutcome> {
    this.calls.push(request);
    this.#running += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.#running);
    await new Promise((resolve) => setImmediate(resolve));
    this.#running -= 1;
    if (this.#fails(request)) return { ok: false, reason: "fallo simulado", usage };
    return {
      ok: true,
      usage,
      plan: {
        files: [{ path: `src/tarea-${request.taskNumber}.ts`, change: "modify" }],
        newTests: [`src/tarea-${request.taskNumber}.test.ts`],
        approach: `plan v${request.planVersion} de la tarea ${request.taskNumber}`,
        estimatedLines: { production: 10, tests: 20 },
        baseSha: "fake-sha",
      },
    };
  }
}
