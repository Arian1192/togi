import { access } from "node:fs/promises";
import {
  type Actor,
  evolve,
  isTaskEvent,
  NO_BUILDING,
  NO_TASK,
  type TaskState,
  type TaskView,
  toDomainEvent,
  type Workspace,
  type WorkspaceId,
} from "@togi/core";
import type Database from "better-sqlite3";
import type { createHandler, HandleResult } from "../commands/handle-command.ts";
import type { SqliteEventStore } from "../store/event-store.ts";
import {
  type ClonePaths,
  clonePaths,
  createTaskClone,
  removeTaskClone,
  taskBranch,
} from "./task-clone.ts";

const system: Actor = { kind: "system", component: "adapter:builder" };
const FINAL: readonly TaskState[] = ["merged", "failed", "rejected"];
/** Una copia por tarea, para siempre: el decider no admite una segunda. */
const workspaceIdOf = (number: number): WorkspaceId => `wsp_${number}`;

export interface TaskWorkspaceDeps {
  db: Database.Database;
  store: SqliteEventStore;
  handle: ReturnType<typeof createHandler>;
  home: string;
}

export type PrepareResult =
  | ({ ok: true; workspace: Workspace } & ClonePaths)
  | { ok: false; code: string };
export type ReleaseResult = { ok: true } | { ok: false; code: string };

/** Lo que hace falta de la tarea, leído del stream: el log manda, no las proyecciones. */
interface TaskRecord {
  view: TaskView;
  repo: string | null;
  /** El `baseSha` del plan aprobado. */
  baseSha: string | null;
  workspace: Workspace | null;
}

const failed = (result: Exclude<HandleResult, { events: unknown }>) => ({
  ok: false as const,
  code: result.kind === "domain_error" ? result.code : result.kind,
});

const present = (paths: ClonePaths): Promise<boolean> =>
  Promise.all([access(paths.tree), access(paths.gitDir)]).then(
    () => true,
    () => false,
  );

/**
 * La copia de trabajo de cada tarea (ADR-011 §3): la crea y registra `workspace.created`, y al
 * llegar a un estado final registra `workspace.released` y la borra. Todo pasa por el handler, y
 * repetir una llamada, también tras una caída a medias, deja el mismo resultado.
 */
export function createTaskWorkspaces({ store, handle, db, home }: TaskWorkspaceDeps) {
  /** Una operación por tarea a la vez: el id es fijo y dos a la vez se pisarían la carpeta. */
  const chains = new Map<number, Promise<unknown>>();
  const serial = <T>(number: number, work: () => Promise<T>): Promise<T> => {
    const next = (chains.get(number) ?? Promise.resolve()).then(work, work);
    const tail = next.catch(() => undefined);
    chains.set(number, tail);
    void tail.then(() => chains.get(number) === tail && chains.delete(number));
    return next;
  };

  const read = async (number: number): Promise<TaskRecord> => {
    const record: TaskRecord = { view: NO_TASK, repo: null, baseSha: null, workspace: null };
    const plans = new Map<number, string>();
    for await (const stored of store.readStream(`task:${number}`)) {
      const event = toDomainEvent(stored);
      if (!isTaskEvent(event)) continue;
      record.view = evolve(record.view, event);
      if (event.type === "task.created") record.repo = event.payload.repo;
      if (event.type === "plan.proposed")
        plans.set(event.payload.planVersion, event.payload.baseSha);
      if (event.type === "decision.recorded" && event.payload.verdict === "approve") {
        record.baseSha = plans.get(event.payload.subject.planVersion) ?? null;
      }
      if (event.type === "workspace.created") record.workspace = event.payload;
    }
    return record;
  };

  /** Tras un rechazo o un fallo al escribir, la carpeta sobra salvo que el log ya la registre. */
  const discard = async (number: number, id: WorkspaceId) => {
    if ((await read(number)).workspace?.workspaceId !== id) await removeTaskClone(home, id);
  };

  const prepare = async (number: number): Promise<PrepareResult> => {
    const { view, repo, baseSha, workspace } = await read(number);
    if (!view.exists || repo === null) return { ok: false, code: "task_not_found" };
    if (workspace) {
      const b = view.building ?? NO_BUILDING;
      if (b.workspaceReleased) return { ok: false, code: "workspace_already_released" };
      const paths = clonePaths(home, workspace.workspaceId);
      if (await present(paths)) return { ok: true, workspace, ...paths };
      // El evento sin la carpeta: se rehace igual solo si nadie ha trabajado aún en ella.
      if (view.state !== "building" || b.cycle !== 1 || b.attempts || b.headSha) {
        return { ok: false, code: "workspace_lost" };
      }
      await removeTaskClone(home, workspace.workspaceId);
      const made = await createTaskClone({ db, home, repo, ...workspace });
      return made.ok ? { ok: true, workspace, ...paths } : made;
    }
    if (view.state !== "building") return { ok: false, code: "invalid_state" };
    if (baseSha === null) return { ok: false, code: "plan_not_found" };
    // Un id por tarea: tras una caída, la carpeta que quedó sin registrar es esta y se rehace.
    const workspaceId = workspaceIdOf(number);
    await removeTaskClone(home, workspaceId);
    const title = await handle.readText(view.title).catch(() => "");
    const branch = taskBranch(number, title);
    const made = await createTaskClone({ db, home, repo, workspaceId, baseSha, branch });
    if (!made.ok) return made;
    let result: HandleResult;
    try {
      result = await handle(system, { type: "createWorkspace", number, workspace: made.workspace });
    } catch (error) {
      await discard(number, workspaceId);
      throw error;
    }
    if (!("events" in result)) {
      await discard(number, workspaceId);
      return failed(result);
    }
    return made;
  };

  /** Primero el evento, que el decider solo admite en un estado final; después, el borrado. */
  const release = async (number: number): Promise<ReleaseResult> => {
    const { view } = await read(number);
    if (!view.exists) return { ok: false, code: "task_not_found" };
    const b = view.building ?? NO_BUILDING;
    // Sin registrar, la carpeta que dejara una caída a medias no la usa nadie: se borra igual.
    if (!b.workspaceId) {
      if (!FINAL.includes(view.state)) return { ok: false, code: "invalid_state" };
      await removeTaskClone(home, workspaceIdOf(number));
      return { ok: true };
    }
    if (!b.workspaceReleased) {
      const result = await handle(system, {
        type: "releaseWorkspace",
        number,
        workspaceId: b.workspaceId,
      });
      if (!("events" in result)) return failed(result);
    }
    await removeTaskClone(home, b.workspaceId);
    return { ok: true };
  };

  return {
    prepareWorkspace: (number: number) => serial(number, () => prepare(number)),
    releaseTaskWorkspace: (number: number) => serial(number, () => release(number)),
  };
}
