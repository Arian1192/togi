import {
  type BlobRef,
  buildBuilderPrompt,
  evolve,
  existingTestsOf,
  isTaskEvent,
  NO_BUILDING,
  NO_TASK,
  type Plan,
  type RepoProfile,
  repoStream,
  type TaskView,
  toDomainEvent,
} from "@togi/core";
import type { SqliteEventStore } from "../store/event-store.ts";
import type { createInstallRunner, InstallResult } from "../workspaces/install-runner.ts";
import { taskGit } from "../workspaces/task-clone.ts";
import type { createTaskWorkspaces } from "../workspaces/task-workspace.ts";
import type { BuildSessionInput } from "./builder-session.ts";

export interface PrepareBuildDeps {
  store: SqliteEventStore;
  readText(ref: BlobRef): Promise<string>;
  workspaces: Pick<ReturnType<typeof createTaskWorkspaces>, "prepareWorkspace">;
  install: Pick<ReturnType<typeof createInstallRunner>, "run">;
  installTimeoutMs: number;
  runtimePaths: readonly string[];
  /** Las instrucciones del especialista del builder: las elige quien llama. */
  instructions: string;
}

/** `string` es el código de `prepareWorkspace`, que no es una unión cerrada. */
export type PrepareBuildResult =
  | { ok: true; input: Omit<BuildSessionInput, "specialist" | "maxTurns"> }
  | {
      ok: false;
      code:
        | "task_not_found"
        | "invalid_state"
        | "plan_not_found"
        | "profile_missing"
        | "list_failed"
        | string;
    }
  | { ok: false; code: "install_failed"; install: InstallResult };

/** Lo que el builder puede escribir: lo que el plan añade o modifica y sus tests nuevos. */
export function planFilesOf(plan: Pick<Plan, "files" | "newTests">): string[] {
  const written = plan.files.filter((f) => f.change !== "delete").map((f) => f.path);
  return [...new Set([...written, ...plan.newTests])];
}

interface TaskRecord {
  view: TaskView;
  repo: string | null;
  baseBranch: string | null;
  plan: Plan | null;
}

/** La tarea y su plan aprobado, leídos del stream: el log manda, no las proyecciones. */
async function readTask(store: SqliteEventStore, number: number): Promise<TaskRecord> {
  const record: TaskRecord = { view: NO_TASK, repo: null, baseBranch: null, plan: null };
  const plans = new Map<number, Plan>();
  for await (const stored of store.readStream(`task:${number}`)) {
    const event = toDomainEvent(stored);
    if (!isTaskEvent(event)) continue;
    record.view = evolve(record.view, event);
    if (event.type === "task.created") {
      record.repo = event.payload.repo;
      record.baseBranch = event.payload.baseBranch;
    }
    if (event.type === "plan.proposed") plans.set(event.payload.planVersion, event.payload);
    if (event.type === "decision.recorded" && event.payload.verdict === "approve") {
      record.plan = plans.get(event.payload.subject.planVersion) ?? null;
    }
  }
  return record;
}

/** El perfil vigente del repo: el del último `repo.profile_set` de su stream. */
async function readProfile(store: SqliteEventStore, repo: string): Promise<RepoProfile | null> {
  let profile: RepoProfile | null = null;
  for await (const stored of store.readStream(repoStream(repo))) {
    const event = toDomainEvent(stored);
    if (event.type === "repo.profile_set") profile = event.payload.profile;
  }
  return profile;
}

/**
 * Monta la entrada de `runBuildSession` desde el log: el plan aprobado, el perfil vigente, el clon y
 * los tests existentes en `baseSha` (ADR-001). Instala solo antes de la primera sesión del ciclo 1
 * (ADR-011 §4). No registra nada: el fallo de la instalación lo registra quien llama.
 */
export async function prepareBuild(
  deps: PrepareBuildDeps,
  number: number,
): Promise<PrepareBuildResult> {
  // Primero el log, sin efectos: un fallo aquí no deja un clon a medias.
  const { view, repo, baseBranch, plan } = await readTask(deps.store, number);
  if (!view.exists || repo === null || baseBranch === null) {
    return { ok: false, code: "task_not_found" };
  }
  if (view.state !== "building") return { ok: false, code: "invalid_state" };
  if (plan === null) return { ok: false, code: "plan_not_found" };
  const profile = await readProfile(deps.store, repo);
  if (profile === null) return { ok: false, code: "profile_missing" };

  const ready = await deps.workspaces.prepareWorkspace(number);
  if (!ready.ok) return ready;
  const { workspace, tree, gitDir } = ready;
  const paths = { tree, gitDir };

  const { cycle, attempts } = view.building ?? NO_BUILDING;
  if (cycle === 1 && (attempts ?? 0) === 0) {
    const install = await deps.install.run({
      paths,
      profile,
      runtimePaths: deps.runtimePaths,
      timeoutMs: deps.installTimeoutMs,
    });
    if (install.status !== "ok") return { ok: false, code: "install_failed", install };
  }

  let files: string[];
  try {
    const listed = await taskGit(paths, ["ls-tree", "-r", "-z", "--name-only", workspace.baseSha]);
    files = listed.split("\0").filter((path) => path !== "");
  } catch {
    return { ok: false, code: "list_failed" };
  }

  const [title, description, acceptanceCriteria, approach] = await Promise.all([
    deps.readText(view.title),
    view.description === null ? null : deps.readText(view.description),
    view.acceptanceCriteria === null ? null : deps.readText(view.acceptanceCriteria),
    deps.readText(plan.approach),
  ]);
  const prompt = buildBuilderPrompt({
    instructions: deps.instructions,
    task: { title, description, acceptanceCriteria },
    plan: { files: plan.files, newTests: plan.newTests, approach },
    repo: { name: repo, baseBranch, checks: profile.checks },
  });
  return {
    ok: true,
    input: {
      number,
      cycle,
      workspace: { ...workspace, ...paths },
      profile,
      planFiles: planFilesOf(plan),
      existingTests: existingTestsOf(files, profile),
      prompt,
    },
  };
}
