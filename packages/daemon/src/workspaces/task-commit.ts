import { type ClonePaths, taskGit } from "./task-clone.ts";

export interface CommitRequest {
  /** `togi/<número>-<slug>`: la rama en la que tiene que estar el clon. */
  branch: string;
  /** Una línea, sin saltos, de 72 caracteres como mucho. */
  subject: string;
  /** El runtime y el modelo del especialista, para el trailer `Assisted-by`. */
  runtime: string;
  model: string;
}

export type CommitResult =
  | { ok: true; headSha: string }
  | { ok: false; code: "invalid_argument" | "wrong_branch" | "no_changes" | "commit_failed" };

const TOKEN = /^[A-Za-z0-9._-]+$/;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const SUBJECT_CHARS = 72;

/** La identidad fija del commit: no se lee la del usuario (ADR-011 §3). */
const IDENTITY = ["-c", "user.name=togi", "-c", "user.email=togi@localhost"];

async function validRequest(paths: ClonePaths, request: CommitRequest): Promise<boolean> {
  const { branch, subject, runtime, model } = request;
  if (!TOKEN.test(runtime) || !TOKEN.test(model)) return false;
  if (subject.trim() === "" || /[\r\n]/.test(subject) || subject.length > SUBJECT_CHARS) {
    return false;
  }
  if (!/^togi\/[^-]/.test(branch)) return false;
  return taskGit(paths, ["check-ref-format", `refs/heads/${branch}`]).then(
    () => true,
    () => false,
  );
}

/**
 * El commit del daemon al terminar la sesión de `building` (ADR-011 §3): todo lo que deja el builder en
 * el árbol, en la rama de la tarea, con la identidad de togi y el trailer `Assisted-by` del especialista.
 * No ejecuta hooks ni lee la configuración del usuario. Sin cambios no hay commit.
 */
export async function commitBuild(
  paths: ClonePaths,
  request: CommitRequest,
): Promise<CommitResult> {
  if (!(await validRequest(paths, request))) return { ok: false, code: "invalid_argument" };
  const head = await taskGit(paths, ["symbolic-ref", "--short", "HEAD"]).catch(() => undefined);
  if (head !== request.branch) return { ok: false, code: "wrong_branch" };
  try {
    await taskGit(paths, ["add", "-A"]);
    const changed = await taskGit(paths, ["diff", "--cached", "--quiet"]).then(
      () => false,
      (error: { code?: unknown }) => {
        if (error.code === 1) return true;
        throw error;
      },
    );
    if (!changed) return { ok: false, code: "no_changes" };
    await taskGit(paths, [
      ...IDENTITY,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "--no-verify",
      "-m",
      request.subject,
      "-m",
      `Assisted-by: ${request.runtime}/${request.model}`,
    ]);
    const headSha = await taskGit(paths, ["rev-parse", "--verify", "HEAD"]);
    if (!SHA.test(headSha)) return { ok: false, code: "commit_failed" };
    return { ok: true, headSha };
  } catch {
    return { ok: false, code: "commit_failed" };
  }
}
