import { execFile } from "node:child_process";
import { chmod, mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Workspace, WorkspaceId } from "@togi/core";
import type Database from "better-sqlite3";
import { type RepoCheck, validateRepo } from "../repos/validate-repo.ts";

const run = promisify(execFile);

export interface CloneRequest {
  db: Database.Database;
  home: string;
  /** owner/repo, tal como está registrado. */
  repo: string;
  workspaceId: WorkspaceId;
  /** El commit sobre el que se planificó (`plan.baseSha`). */
  baseSha: string;
  /** `togi/<número>-<slug>`; ver `taskBranch`. */
  branch: string;
}

/** Dónde vive el clon: el árbol, que ve el sandbox, y el directorio de git, que no lo ve. */
export interface ClonePaths {
  tree: string;
  gitDir: string;
}

export type CloneResult =
  | ({ ok: true; workspace: Workspace } & ClonePaths)
  | {
      ok: false;
      code:
        | Exclude<RepoCheck, { ok: true }>["code"]
        | "invalid_argument"
        | "repo_not_registered"
        | "commit_not_found"
        | "clone_failed";
    };

const ID = /^wsp_[A-Za-z0-9_-]+$/;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** La carpeta del clon, o un error si el id saldría de `workspaces/`. */
function workspaceDir(home: string, id: string): string {
  const workspaces = join(home, "workspaces");
  const dir = join(workspaces, id);
  if (!ID.test(id) || dirname(dir) !== workspaces || basename(dir) !== id) {
    throw new Error("id de copia de trabajo no válido");
  }
  return dir;
}

/** El árbol y el directorio de git del clon, sacados del id validado. */
export function clonePaths(home: string, workspaceId: WorkspaceId): ClonePaths {
  const dir = workspaceDir(home, workspaceId);
  return { tree: join(dir, "tree"), gitDir: join(dir, "git") };
}

/**
 * Todo `git` sobre el clon: sin la configuración del usuario ni la del sistema, sin hooks y con el
 * directorio de git y el árbol explícitos, sin fiarse del fichero `.git` del árbol (ADR-011 §3). El
 * entorno no hereda nada del daemon salvo `PATH`.
 */
const gitEnv = (home: string): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH,
  HOME: home,
  XDG_CONFIG_HOME: home,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
});

export async function taskGit(paths: ClonePaths, args: readonly string[]): Promise<string> {
  const { stdout } = await run(
    "git",
    [
      `--git-dir=${paths.gitDir}`,
      `--work-tree=${paths.tree}`,
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd: paths.tree, env: gitEnv(dirname(paths.tree)) },
  );
  return stdout.trim();
}

async function validBranch(branch: string): Promise<boolean> {
  if (!/^togi\/[^-]/.test(branch)) return false;
  return run("git", ["check-ref-format", `refs/heads/${branch}`], { env: gitEnv("/") }).then(
    () => true,
    () => false,
  );
}

/**
 * Crea `<home>/workspaces/<id>/{tree,git}`: un clon local propio de togi del repo registrado, con el
 * directorio de git fuera del árbol, y la rama de la tarea en el commit base. Ni el clon ni el checkout
 * ejecutan hooks, plantillas ni filtros: el clon no hereda la configuración del repo del usuario, y la
 * global y la del sistema se ignoran. Si algo falla, no deja nada.
 */
export async function createTaskClone(request: CloneRequest): Promise<CloneResult> {
  const { db, home, repo, workspaceId, baseSha, branch } = request;
  let dir: string;
  try {
    dir = workspaceDir(home, workspaceId);
  } catch {
    return { ok: false, code: "invalid_argument" };
  }
  if (!SHA.test(baseSha) || !(await validBranch(branch))) {
    return { ok: false, code: "invalid_argument" };
  }
  const row = db.prepare("SELECT path FROM repos WHERE repo = ?").get(repo) as
    | { path: string }
    | undefined;
  if (row === undefined) return { ok: false, code: "repo_not_registered" };
  const checked = await validateRepo(repo, row.path, home);
  if (!checked.ok) return { ok: false, code: checked.code };

  try {
    await mkdir(dirname(dir), { recursive: true, mode: 0o700 });
    await mkdir(dir, { mode: 0o700 }); // falla si ya existe: no se borra lo que no es nuestro
  } catch {
    return { ok: false, code: "clone_failed" };
  }
  const paths = { tree: join(dir, "tree"), gitDir: join(dir, "git") };
  const fail = async (code: "commit_not_found" | "clone_failed") => {
    await removeTaskClone(home, workspaceId);
    return { ok: false, code } as const;
  };
  try {
    await run(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "clone",
        "-q",
        "--local",
        "--no-checkout",
        "--template=",
        `--separate-git-dir=${paths.gitDir}`,
        "--",
        checked.path,
        paths.tree,
      ],
      { cwd: dir, env: gitEnv(dir) },
    );
  } catch {
    return fail("clone_failed");
  }
  const found = await taskGit(paths, ["rev-parse", "--verify", "--quiet", `${baseSha}^{commit}`])
    .then((sha) => sha === baseSha)
    .catch(() => false);
  if (!found) return fail("commit_not_found");
  try {
    await taskGit(paths, ["checkout", "-q", "-b", branch, baseSha]);
  } catch {
    return fail("clone_failed");
  }
  return {
    ok: true,
    workspace: { workspaceId, kind: "clone", ref: dir, branch, baseSha },
    ...paths,
  };
}

/** Recorre el árbol sin seguir enlaces dando permiso de escritura a cada carpeta, para poder borrarla. */
async function unlock(path: string): Promise<void> {
  await chmod(path, 0o700);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) await unlock(join(path, entry.name));
  }
}

/**
 * Borra el clon de la tarea (`workspace.released`). La ruta sale del id, nunca del `ref` del evento.
 * Idempotente; rechaza un id que saldría de `workspaces/`.
 */
export async function removeTaskClone(home: string, workspaceId: WorkspaceId): Promise<void> {
  const dir = workspaceDir(home, workspaceId);
  await unlock(dir).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
}

const SLUG_CHARS = 40;

/** La rama de la tarea, `togi/<número>-<slug>`, con un slug ASCII corto sacado del título. */
export function taskBranch(taskNumber: number, title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_CHARS)
    .replace(/^-+|-+$/g, "");
  return slug ? `togi/${taskNumber}-${slug}` : `togi/${taskNumber}`;
}
