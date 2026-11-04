import { type ChildProcess, execFile, spawn } from "node:child_process";
import { chmod, lstat, mkdir, readdir, readlink, realpath, rm, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { SessionIdSchema } from "@togi/core";
import type Database from "better-sqlite3";
import { type RepoCheck, validateRepo } from "../repos/validate-repo.ts";

const run = promisify(execFile);

export interface CopyRequest {
  db: Database.Database;
  home: string;
  /** owner/repo, tal como está registrado. */
  repo: string;
  baseBranch: string;
  sessionId: string;
}

export type CopyResult =
  | { ok: true; path: string; baseSha: string; source: "origin" | "local" }
  | {
      ok: false;
      code:
        | Exclude<RepoCheck, { ok: true }>["code"]
        | "invalid_argument"
        | "repo_not_registered"
        | "branch_not_found"
        | "export_failed";
    };

const git = async (repo: string, args: string[]): Promise<string | undefined> => {
  try {
    return (await run("git", ["-C", repo, ...args])).stdout.trim();
  } catch {
    return undefined;
  }
};

const exited = (child: ChildProcess): Promise<number> =>
  new Promise((done) => {
    child.on("error", () => done(-1));
    child.on("close", (code) => done(code ?? -1));
  });

const inside = (root: string, path: string): boolean =>
  path === root || path.startsWith(`${root}/`);

/** Recorre el árbol sin seguir enlaces; `visit` ve cada entrada antes de descender a ella. */
async function walk(dir: string, visit: (path: string, isDir: boolean) => Promise<void>) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    await visit(path, entry.isDirectory());
    if (entry.isDirectory()) await walk(path, visit);
  }
}

/** Borra los enlaces simbólicos cuyo destino real cae fuera de la copia (o que no se resuelven así). */
async function dropEscapingLinks(root: string) {
  const realRoot = await realpath(root);
  await walk(root, async (path) => {
    if (!(await lstat(path)).isSymbolicLink()) return;
    const target = await realpath(path).catch(async () =>
      resolve(dirname(path), await readlink(path)),
    );
    if (!inside(realRoot, target) && !inside(root, target)) await unlink(path);
  });
}

/** Deja la copia sin permiso de escritura: directorios en 0555 (de hojas a raíz) y ficheros sin w. */
async function makeReadOnly(root: string) {
  const dirs = [root];
  await walk(root, async (path, isDir) => {
    const stat = await lstat(path);
    if (isDir) dirs.push(path);
    else if (!stat.isSymbolicLink()) await chmod(path, stat.mode & ~0o222);
  });
  for (const dir of dirs.reverse()) await chmod(dir, 0o555);
}

/**
 * Exporta el commit con `git archive | tar -x`, sin shell. A diferencia de `git worktree`, no hace
 * checkout, así que no ejecuta ningún hook del repo (tampoco los de core.hooksPath) fuera del sandbox.
 */
async function exportTree(repo: string, sha: string, dest: string): Promise<boolean> {
  const archive = spawn("git", ["-C", repo, "archive", "--format=tar", sha], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const extract = spawn("tar", ["-x", "-f", "-", "-C", dest], {
    stdio: ["pipe", "ignore", "ignore"],
  });
  const done = Promise.all([exited(archive), exited(extract)]);
  await pipeline(archive.stdout, extract.stdin).catch(() => undefined);
  return (await done).every((code) => code === 0);
}

/**
 * Prepara `<home>/workspaces/<sesión>` con el árbol de la rama base, sin tocar el clon del usuario.
 * El repo registrado puede haber cambiado desde el alta: se revalida antes de crear nada.
 */
export async function createReadOnlyCopy(request: CopyRequest): Promise<CopyResult> {
  const { db, home, repo, baseBranch, sessionId } = request;
  const workspaces = join(home, "workspaces");
  const dest = join(workspaces, sessionId);
  const validRef =
    !baseBranch.startsWith("-") &&
    (await run("git", ["check-ref-format", `refs/heads/${baseBranch}`]).then(
      () => true,
      () => false,
    ));
  if (
    !SessionIdSchema.safeParse(sessionId).success ||
    sessionId.includes("\0") ||
    dirname(dest) !== workspaces ||
    basename(dest) !== sessionId ||
    !validRef
  ) {
    return { ok: false, code: "invalid_argument" };
  }
  const row = db.prepare("SELECT path FROM repos WHERE repo = ?").get(repo) as
    | { path: string }
    | undefined;
  if (row === undefined) return { ok: false, code: "repo_not_registered" };
  const checked = await validateRepo(repo, row.path, home);
  if (!checked.ok) return { ok: false, code: checked.code };

  const commit = (ref: string) =>
    git(checked.path, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  const fromOrigin = await commit(`refs/remotes/origin/${baseBranch}`);
  const baseSha = fromOrigin || (await commit(`refs/heads/${baseBranch}`));
  if (!baseSha) return { ok: false, code: "branch_not_found" };

  try {
    await mkdir(workspaces, { recursive: true, mode: 0o700 });
    await mkdir(dest, { mode: 0o700 }); // falla si ya existe: no se borra lo que no es nuestro
  } catch {
    return { ok: false, code: "export_failed" };
  }
  try {
    if (!(await exportTree(checked.path, baseSha, dest))) throw new Error("export");
    await dropEscapingLinks(dest);
    await makeReadOnly(dest);
  } catch {
    await removeReadOnlyCopy(dest);
    return { ok: false, code: "export_failed" };
  }
  return { ok: true, path: dest, baseSha, source: fromOrigin ? "origin" : "local" };
}

/** Borra la copia aunque esté en solo lectura. Idempotente. */
export async function removeReadOnlyCopy(path: string): Promise<void> {
  await chmod(path, 0o700).catch(() => undefined);
  await walk(path, async (entry, isDir) => {
    if (isDir) await chmod(entry, 0o700);
  }).catch(() => undefined);
  await rm(path, { recursive: true, force: true });
}

/** Crea la copia, ejecuta `fn` y la borra siempre, también si `fn` lanza. */
export async function withReadOnlyCopy<T>(
  request: CopyRequest,
  fn: (copy: { path: string; baseSha: string; source: "origin" | "local" }) => Promise<T>,
): Promise<{ ok: true; value: T } | Extract<CopyResult, { ok: false }>> {
  const copy = await createReadOnlyCopy(request);
  if (!copy.ok) return copy;
  try {
    return { ok: true, value: await fn(copy) };
  } finally {
    await removeReadOnlyCopy(copy.path);
  }
}
