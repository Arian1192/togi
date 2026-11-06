import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type AGENT_CREDENTIAL_MODES,
  buildPlannerPrompt,
  type FailureReason,
  type PlannerPromptInput,
  planWithRetry,
  type SessionOrder,
  specialistHash,
  type Usage,
} from "@togi/core";
import type { AgentCredentials } from "../credentials/agent-credential.ts";
import type { createWorkerLauncher } from "../worker/worker-launcher.ts";
import { withReadOnlyCopy } from "../workspaces/read-only-copy.ts";
import type { Planner, PlannerIdentity, PlanOutcome, PlanRequest } from "./planner.ts";
import { type TaskTextSource, taskPromptInput } from "./task-prompt-input.ts";

/** Lo que un adaptador necesita del sandbox (ADR-008 §7); el daemon no importa el paquete del worker. */
export interface RuntimeDeclaration {
  domains: readonly string[];
  credentials: readonly { name: string; injectDomains: readonly string[] }[];
  clearEnv: readonly string[];
  writablePaths: readonly "writeDir"[];
  ownSandbox: boolean;
}

export interface ClaudePlannerDeps extends TaskTextSource {
  home: string;
  credentials: Pick<AgentCredentials, "status" | "read">;
  launcher: ReturnType<typeof createWorkerLauncher>;
  declaration(mode: (typeof AGENT_CREDENTIAL_MODES)[number]): RuntimeDeclaration;
  /** Fichero que el trabajador ejecuta dentro del sandbox. */
  agentEntry: string;
  runtime: { id: string; version: string };
  /** Las carpetas que el sandbox deja leer además de la copia (`claudeRuntime().paths`). */
  runtimePaths: readonly string[];
  maxCostUsd: number;
  /** Tope de toda la sesión, reintento incluido. */
  timeoutMs?: number;
}

export const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const sum = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  estimatedCostUsd: a.estimatedCostUsd + b.estimatedCostUsd,
  durationMs: a.durationMs + b.durationMs,
});

/** El lanzamiento falló (no es un problema de formato del plan): no se reintenta. */
class AgentRunFailed extends Error {
  readonly code: FailureReason;
  readonly detail: string;
  constructor(code: FailureReason, detail: string) {
    super(detail);
    this.code = code;
    this.detail = detail;
  }
}

/**
 * El planificador real: copia de solo lectura del repo, credencial del modo activo, sandbox por el
 * trabajador, y el plan validado con un único reintento. La copia y el directorio desechable se borran
 * siempre. Sin credencial devuelve `planner_failed`; el motivo propio llega en el PR 16c.
 */
export class ClaudePlanner implements Planner {
  readonly #deps: ClaudePlannerDeps;
  /** El prompt registrado en `session.started` y el que se envía son el mismo: el nonce se fija una vez. */
  readonly #prompts = new Map<string, PlannerPromptInput>();

  constructor(deps: ClaudePlannerDeps) {
    this.#deps = deps;
  }

  readonly identity = async (request: PlanRequest): Promise<PlannerIdentity> => {
    const { specialist } = request;
    if (specialist === undefined) throw new Error("el planificador real necesita un especialista");
    const d = this.#deps;
    const input: PlannerPromptInput = {
      ...(await taskPromptInput(d, request.taskNumber)),
      instructions: specialist.instructions,
      nonce: randomBytes(16).toString("hex"),
    };
    this.#prompts.set(request.sessionId, input);
    const mode = await d.credentials.status();
    const policy = {
      tools: specialist.tools,
      timeoutMs: d.timeoutMs ?? SESSION_TIMEOUT_MS,
      maxCostUsd: d.maxCostUsd,
      credentialMode: mode === "inconsistent" ? null : mode,
      sandbox: mode === null || mode === "inconsistent" ? null : sandboxPolicy(d.declaration(mode)),
    };
    return {
      runtime: d.runtime,
      model: specialist.model,
      specialist: {
        id: specialist.id,
        version: specialist.version,
        hash: specialistHash(specialist),
      },
      prompt: buildPlannerPrompt(input),
      policy: JSON.stringify(policy),
    };
  };

  async plan(request: PlanRequest): Promise<PlanOutcome> {
    const d = this.#deps;
    const input = this.#prompts.get(request.sessionId);
    this.#prompts.delete(request.sessionId);
    const none: Usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, durationMs: 0 };
    const fail = (code: FailureReason, reason: string, usage = none, trajectoryEvents = 0) =>
      ({ ok: false, code, reason, usage, trajectoryEvents }) as const;
    if (input === undefined || request.specialist === undefined) {
      return fail("planner_error", "la sesión no pasó por identity");
    }
    const credential = await d.credentials.read();
    if (credential === null) return fail("planner_failed", "no hay credencial configurada");
    const declaration = d.declaration(credential.mode);
    const deadline = Date.now() + (d.timeoutMs ?? SESSION_TIMEOUT_MS);
    const { sessionId, taskNumber } = request;

    const copied = await withReadOnlyCopy(
      {
        db: d.db,
        home: d.home,
        repo: input.repo.name,
        baseBranch: input.repo.baseBranch,
        sessionId,
      },
      async (copy) => {
        const scratch = join(d.home, "workspaces", `${sessionId}.scratch`);
        await mkdir(scratch, { mode: 0o700 });
        let usage = none;
        let events = 0;
        try {
          const run = async (prompt: string): Promise<string> => {
            const left = deadline - Date.now();
            if (left < 1000) throw new AgentRunFailed("timeout", "se agotó el tiempo de la sesión");
            const budget = d.maxCostUsd - usage.estimatedCostUsd;
            if (budget <= 0) throw new AgentRunFailed("budget_exceeded", "tope de coste agotado");
            const order: SessionOrder = {
              type: "session",
              sessionId,
              spec: {
                readPaths: [copy.path],
                writeDir: scratch,
                allowedDomains: [...declaration.domains],
                allowedEnv: [
                  "PATH",
                  ...declaration.clearEnv,
                  ...declaration.credentials.map((c) => c.name),
                ],
                credentials: declaration.credentials.map((c) => ({
                  name: c.name,
                  injectDomains: [...c.injectDomains],
                })),
                timeoutMs: left,
              },
              workspacesRoot: join(d.home, "workspaces"),
              runtimePaths: [...d.runtimePaths],
              argv: [process.execPath, d.agentEntry],
              input: JSON.stringify({
                prompt,
                cwd: copy.path,
                model: request.specialist?.model,
                maxBudgetUsd: budget,
              }),
              credential: { name: credential.envName, secret: credential.secret },
            };
            const launch = await d.launcher.run(order, taskNumber);
            usage = sum(usage, launch.usage);
            events += launch.trajectoryEvents;
            if (launch.outcome !== "completed") {
              const code = launch.failureReason ?? "planner_failed";
              throw new AgentRunFailed(code, `${launch.outcome}: ${launch.diagnostics}`);
            }
            return launch.finalText ?? "";
          };
          try {
            const attempt = await planWithRetry(input, run);
            if (!attempt.ok) return fail(attempt.code, attempt.error, usage, events);
            const plan = { ...attempt.plan, baseSha: copy.baseSha };
            return { ok: true, plan, usage, trajectoryEvents: events } as const;
          } catch (error) {
            if (!(error instanceof AgentRunFailed)) throw error;
            return fail(error.code, error.detail, usage, events);
          }
        } finally {
          await rm(scratch, { recursive: true, force: true });
        }
      },
    );
    return copied.ok
      ? copied.value
      : fail(copyFailure(copied.code), `copia del repo: ${copied.code}`);
  }
}

const copyFailure = (code: string): FailureReason =>
  code === "repo_not_registered" ? "repo_not_registered" : "planner_failed";

const sandboxPolicy = (declaration: RuntimeDeclaration) => ({
  domains: declaration.domains,
  maskedCredentials: declaration.credentials.map((c) => c.name),
  clearEnv: declaration.clearEnv,
});
