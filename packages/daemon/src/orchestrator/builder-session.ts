import { randomUUID } from "node:crypto";
import {
  type Actor,
  type FailureReason,
  isTransientFailure,
  type RepoProfile,
  type Specialist,
  specialistHash,
  type Usage,
  VersionConflictError,
  type Workspace,
} from "@togi/core";
import type { createHandler, HandleResult } from "../commands/handle-command.ts";
import {
  type AgentCredentials,
  InconsistentCredentialsError,
} from "../credentials/agent-credential.ts";
import type { CredentialMode } from "../keys/secret-store.ts";
import type { createWorkerLauncher } from "../worker/worker-launcher.ts";
import { type ClonePaths, taskGit } from "../workspaces/task-clone.ts";
import { commitBuild } from "../workspaces/task-commit.ts";
import { builderOrder } from "./builder-order.ts";
import type { RuntimeDeclaration } from "./claude-planner.ts";
import { describeFailure } from "./describe-failure.ts";

const system: Actor = { kind: "system", component: "adapter:builder" };
const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, durationMs: 0 };

export interface BuildSessionDeps {
  handle: ReturnType<typeof createHandler>;
  launcher: Pick<ReturnType<typeof createWorkerLauncher>, "run">;
  credentials: Pick<AgentCredentials, "read">;
  declaration(mode: CredentialMode): RuntimeDeclaration;
  builderEntry: string;
  runtime: { id: string; version: string };
  runtimePaths: readonly string[];
  executable: string;
  maxCostUsd: number;
  timeoutMs: number;
  commit?: typeof commitBuild;
}

export interface BuildSessionInput {
  number: number;
  cycle: number;
  workspace: Workspace & ClonePaths;
  profile: RepoProfile;
  planFiles: readonly string[];
  existingTests: readonly string[];
  prompt: string;
  specialist: Specialist;
  /** Sin valor por defecto: el tope de turnos del builder se decide fuera (PR 6). */
  maxTurns: number;
}

export type BuildSessionResult =
  | { kind: "submitted"; headSha: string }
  | { kind: "paused"; reason: string }
  | { kind: "not_started"; code: string }
  | { kind: "commit_failed" };

type Attempt = BuildSessionResult | { kind: "ended"; failure: FailureReason | null };

const log = (what: string, detail: unknown) =>
  console.error(`builder: ${what}: ${JSON.stringify(describeFailure(detail))}`);
const codeOf = (result: Exclude<HandleResult, { events: unknown }>) =>
  result.kind === "domain_error" ? result.code : result.kind;

/** Una sesión del builder: la abre, lanza al agente en el clon y la cierra. Todo por el handler. */
async function runOnce(deps: BuildSessionDeps, input: BuildSessionInput): Promise<Attempt> {
  const { number, cycle, specialist, workspace } = input;
  // La credencial se lee antes de abrir la sesión, para registrar su modo en la política.
  const credential = await deps.credentials.read().catch((error: unknown) => {
    if (error instanceof InconsistentCredentialsError) return null;
    throw error;
  });
  const { timeoutMs, maxCostUsd } = deps;
  const policy = JSON.stringify({
    tools: specialist.tools,
    timeoutMs,
    maxCostUsd,
    maxTurns: input.maxTurns,
    credentialMode: credential?.mode ?? null,
  });
  const sessionId = `ses_${randomUUID()}` as const;
  const { id, version } = specialist;
  const start = () =>
    deps.handle(system, {
      type: "startSession",
      number,
      session: {
        sessionId,
        role: "builder",
        cycle,
        runtime: deps.runtime,
        model: specialist.model,
        specialist: { id, version, hash: specialistHash(specialist) },
        workspaceId: workspace.workspaceId,
        prompt: input.prompt,
        policy,
      },
    });
  // Otra escritura en el stream justo al abrir: se vuelve a decidir sobre el estado nuevo, una vez.
  const started = await start().catch((error: unknown) => {
    if (error instanceof VersionConflictError) return start();
    throw error;
  });
  if (!("events" in started)) return { kind: "not_started", code: codeOf(started) };

  let failure: FailureReason | null = "credential_missing";
  let usage = NO_USAGE;
  let trajectoryEvents = 0;
  if (credential !== null) {
    try {
      const order = builderOrder(
        {
          ...deps,
          ...input,
          paths: workspace,
          model: specialist.model,
          // El esfuerzo del builder es `medium` (ADR-011 §8); `builderOrder` no admite uno ausente.
          effort: specialist.effort ?? "medium",
          maxBudgetUsd: maxCostUsd,
          declaration: deps.declaration(credential.mode),
          credential: { name: credential.envName, secret: credential.secret },
        },
        sessionId,
      );
      const launch = await deps.launcher.run(order, number);
      ({ usage, trajectoryEvents } = launch);
      failure = launch.outcome === "completed" ? null : (launch.failureReason ?? "agent_failed");
      if (launch.outcome === "timeout") failure = "timeout";
      if (failure)
        log(`la sesión ${sessionId} de la tarea ${number} falló (${failure})`, launch.diagnostics);
    } catch (error) {
      failure = "agent_failed";
      log(`la sesión ${sessionId} de la tarea ${number} lanzó`, error);
    }
  }
  // El tope de tiempo se escribe `failed` con `timeout`: la forma que acepta `mayDeliver`.
  const outcome = failure === null ? "completed" : "failed";
  const ended = await deps.handle(system, {
    type: "endSession",
    number,
    session: { sessionId, outcome, usage, trajectoryEvents, failureReason: failure },
  });
  if (!("events" in ended)) {
    log(`no se cerró la sesión ${sessionId} de la tarea ${number}`, ended);
    return { kind: "paused", reason: codeOf(ended) };
  }
  return { kind: "ended", failure };
}

/** El commit de togi en la rama de la tarea (ADR-011 §3) y la entrega; sin cambios, el `HEAD` actual. */
async function deliver(
  deps: BuildSessionDeps,
  input: BuildSessionInput,
): Promise<BuildSessionResult> {
  const { number, cycle, workspace, specialist } = input;
  const committed = await (deps.commit ?? commitBuild)(workspace, {
    branch: workspace.branch,
    subject: `togi(${number}): ciclo ${cycle}`,
    runtime: specialist.runtime,
    model: specialist.model,
  });
  // Sin cambios se entrega el `HEAD` del clon: desde el ciclo 2 ya no es `baseSha`.
  const headSha = committed.ok
    ? committed.headSha
    : committed.code === "no_changes"
      ? await taskGit(workspace, ["rev-parse", "--verify", "HEAD"]).catch(() => null)
      : null;
  if (headSha === null) {
    const code = committed.ok ? "rev_parse_failed" : committed.code;
    log(`no se hizo el commit de la tarea ${number} en el ciclo ${cycle}`, code);
    return { kind: "commit_failed" };
  }
  const submitted = await deps.handle(system, { type: "submitBuild", number, cycle, headSha });
  if (!("events" in submitted)) {
    log(`no se entregó la tarea ${number} en el ciclo ${cycle}`, submitted);
    return { kind: "paused", reason: codeOf(submitted) };
  }
  return { kind: "submitted", headSha };
}

/**
 * La sesión de `building` de un ciclo (ADR-011): tras `completed` o `timeout`, commit y entrega;
 * cualquier otro fallo deja la tarea en `building`, en pausa, sin gastar ciclo. Tras una caída
 * pasajera se abre una segunda sesión en el mismo ciclo, una sola vez (enmienda del ADR-004 del 11 de
 * noviembre); parte del clon tal como lo dejó la primera.
 */
export async function runBuildSession(
  deps: BuildSessionDeps,
  input: BuildSessionInput,
): Promise<BuildSessionResult> {
  let attempt = await runOnce(deps, input);
  if (attempt.kind === "ended" && isTransientFailure(attempt.failure))
    attempt = await runOnce(deps, input);
  if (attempt.kind !== "ended") return attempt;
  if (attempt.failure === null || attempt.failure === "timeout") return deliver(deps, input);
  return { kind: "paused", reason: attempt.failure };
}
