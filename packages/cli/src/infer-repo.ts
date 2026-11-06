import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CreateTask, parseGithubRemote } from "@togi/core";

const run = promisify(execFile);

/** Por qué no se pudo deducir el repo del directorio. */
export type InferFailure = "not_a_repo" | "no_origin" | "not_github" | "not_registered";

export type Inferred =
  | { ok: true; repo: string; baseBranch: string | undefined }
  | { ok: false; reason: InferFailure; repo?: string };

const git = async (cwd: string, args: string[]): Promise<string | undefined> => {
  try {
    return (await run("git", ["-C", cwd, ...args])).stdout.trim();
  } catch {
    return undefined;
  }
};

/**
 * El repo de `cwd` y su rama base. El repo sale del remote `origin` (solo GitHub) y tiene que estar
 * entre los registrados, sin distinguir mayúsculas: se devuelve con el nombre registrado. La rama
 * sale de `origin/HEAD`, la rama por defecto del remote; si no existe o su nombre no es válido, es
 * `undefined` y no se adivina ninguna. `git` se lanza sin shell y solo lee configuración local.
 */
export async function inferRepo(cwd: string, registered: readonly string[]): Promise<Inferred> {
  if ((await git(cwd, ["rev-parse", "--show-toplevel"])) === undefined) {
    return { ok: false, reason: "not_a_repo" };
  }
  const url = await git(cwd, ["remote", "get-url", "origin"]);
  if (url === undefined) return { ok: false, reason: "no_origin" };
  const found = parseGithubRemote(url);
  if (found === undefined) return { ok: false, reason: "not_github" };
  const repo = registered.find((r) => r.toLowerCase() === found.toLowerCase());
  if (repo === undefined) return { ok: false, reason: "not_registered", repo: found };

  const head = await git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const branch = head?.startsWith("origin/") ? head.slice("origin/".length) : undefined;
  const valid = branch !== undefined && CreateTask.shape.baseBranch.safeParse(branch).success;
  return { ok: true, repo, baseBranch: valid ? branch : undefined };
}
