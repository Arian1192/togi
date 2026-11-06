import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { promisify } from "node:util";
import { parseGithubRemote } from "@togi/core";

const run = promisify(execFile);

export type RepoCheck =
  | { ok: true; path: string }
  | {
      ok: false;
      code: "path_not_found" | "inside_togi_home" | "not_a_git_repo" | "remote_mismatch";
    };

const git = async (path: string, args: string[]): Promise<string | undefined> => {
  try {
    return (await run("git", ["-C", path, ...args])).stdout.trim();
  } catch {
    return undefined;
  }
};

const isInside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

/**
 * Comprueba que `path` es la raíz de un clon git de `repo` (owner/repo) y que no cae dentro de
 * `home`. Compara rutas reales, así que un enlace simbólico no esquiva la regla. Devuelve la ruta
 * resuelta, que es la que se guarda.
 */
export async function validateRepo(repo: string, path: string, home: string): Promise<RepoCheck> {
  let real: string;
  try {
    real = await realpath(path);
  } catch {
    return { ok: false, code: "path_not_found" };
  }
  if (isInside(await realpath(home), real)) return { ok: false, code: "inside_togi_home" };
  const top = await git(real, ["rev-parse", "--show-toplevel"]);
  if (top === undefined || (await realpath(top).catch(() => undefined)) !== real) {
    return { ok: false, code: "not_a_git_repo" };
  }
  const urls = (await git(real, ["config", "--get-regexp", "^remote\\..*\\.url$"])) ?? "";
  const wanted = repo.toLowerCase();
  const matches = urls.split("\n").some((line) => {
    const found = parseGithubRemote(line.split(" ").slice(1).join(" "));
    return found !== undefined && found.toLowerCase() === wanted;
  });
  return matches ? { ok: true, path: real } : { ok: false, code: "remote_mismatch" };
}
