import { dirname, join } from "node:path";
import { type Effort, protectedPathsOf, type RepoProfile, type SessionOrder } from "@togi/core";
import type { ClonePaths } from "../workspaces/task-clone.ts";
import type { RuntimeDeclaration } from "./claude-planner.ts";

export interface BuilderRequest {
  paths: ClonePaths;
  profile: RepoProfile;
  /** Los `add` y `modify` del plan más sus `newTests`, y los tests de `baseSha`: relativos al árbol. */
  planFiles: readonly string[];
  existingTests: readonly string[];
  prompt: string;
  model: string;
  effort: Effort;
  /** Sin valor por defecto: el tope del builder se decide antes de usarlo. */
  maxTurns: number;
  maxBudgetUsd: number;
  executable?: string;
  /** La declaración y el punto de entrada se inyectan: el daemon no importa el paquete del worker. */
  declaration: RuntimeDeclaration;
  builderEntry: string;
  runtimePaths: readonly string[];
  credential: SessionOrder["credential"];
  timeoutMs: number;
}

/**
 * La orden de la sesión del builder (ADR-011 §4): escribe en el árbol del clon, con red solo a la
 * de la declaración (nunca al registro del perfil) y `HOME` en una carpeta desechable junto al árbol.
 */
export function builderOrder(request: BuilderRequest, sessionId: string): SessionOrder {
  const { declaration, paths, profile, planFiles, existingTests } = request;
  const dir = dirname(paths.tree);
  const { prompt, model, effort, maxTurns, maxBudgetUsd, executable } = request;
  const policy = { checks: profile.checks, planFiles, existingTests };
  return {
    type: "session",
    sessionId,
    spec: {
      readPaths: [],
      writeDir: join(dir, "builder"),
      workTree: paths.tree,
      allowedDomains: [...declaration.domains],
      allowedEnv: ["PATH", ...declaration.clearEnv, ...declaration.credentials.map((c) => c.name)],
      credentials: declaration.credentials.map((c) => ({
        ...c,
        injectDomains: [...c.injectDomains],
      })),
      timeoutMs: request.timeoutMs,
    },
    workspacesRoot: dirname(dir),
    runtimePaths: [...request.runtimePaths],
    argv: [process.execPath, request.builderEntry],
    input: JSON.stringify({
      prompt,
      cwd: paths.tree,
      model,
      effort,
      maxTurns,
      maxBudgetUsd,
      executable,
      policy: { ...policy, protectedPaths: protectedPathsOf(profile) },
    }),
    credential: request.credential,
  };
}
