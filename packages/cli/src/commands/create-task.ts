import { CreateTask } from "@togi/core";
import { createClient } from "../client.ts";
import { usageError } from "../errors.ts";
import { clean, say } from "../format.ts";
import { inferRepo } from "../infer-repo.ts";
import { MESSAGES } from "../messages.ts";
import type { Output } from "../output.ts";

export interface Created {
  number: number;
  /** `null` con `titleErased` si se repite una creación idempotente cuyo título ya se borró. */
  title: string | null;
  titleErased: boolean;
  state: string;
  risk: string;
  hasCriteria: boolean;
}

/** El repo y la rama base de una tarea nueva, y qué de ello salió del directorio. */
export interface RepoBase {
  repo: string;
  baseBranch: string | undefined;
  deduced: { repo: string; baseBranch: string | undefined } | undefined;
}

/**
 * `--repo` y `--base` mandan. Sin `--repo` se deduce del directorio (U1): lo que no se puede deducir
 * se pide, nunca se supone. Con `--repo` y sin `--base`, la rama es la de la API.
 */
export async function resolveRepoBase(
  home: string,
  flags: { repo: string | undefined; base: string | undefined },
  command: string,
): Promise<RepoBase> {
  const { repo: given, base } = flags;
  // Un --base que la API rechazaría se rechaza ya, antes de consultar al daemon para deducir.
  if (base !== undefined && !CreateTask.shape.baseBranch.safeParse(base).success) {
    throw usageError("invalid_option", { field: "--base", command });
  }
  if (given !== undefined) return { repo: given, baseBranch: base, deduced: undefined };
  const lookup = createClient(home);
  const { repos } = await lookup.checked<{ repos: { repo: string }[] }>(
    await lookup.api.v1.repos.$get(),
  );
  const found = await inferRepo(
    process.cwd(),
    repos.map((r) => r.repo),
  );
  if (!found.ok) {
    throw usageError("repo_not_inferred", {
      reason: found.reason,
      ...(found.repo === undefined ? {} : { repo: found.repo }),
      command,
    });
  }
  if (base !== undefined) {
    return {
      repo: found.repo,
      baseBranch: base,
      deduced: { repo: found.repo, baseBranch: undefined },
    };
  }
  if (found.baseBranch === undefined) {
    throw usageError("base_not_inferred", { repo: found.repo, command });
  }
  const deduced = { repo: found.repo, baseBranch: found.baseBranch };
  return { ...deduced, deduced };
}

/** `POST /v1/tasks` con una clave de idempotencia: repetirla no crea otra tarea. */
export async function postTask(home: string, body: unknown, key: string): Promise<Created> {
  const client = createClient(home);
  return client.checked<Created>(
    await client.api.v1.tasks.$post(
      {},
      {
        headers: { "idempotency-key": key, "content-type": "application/json" },
        init: { body: JSON.stringify(body) },
      },
    ),
  );
}

/** Lo deducido se dice: nada de elegir el repo ni la rama en silencio. */
export const inferredLine = (deduced: NonNullable<RepoBase["deduced"]>): string =>
  MESSAGES.repo_inferred?.({
    repo: deduced.repo,
    ...(deduced.baseBranch === undefined ? {} : { base: deduced.baseBranch }),
  }).text ?? "";

export function createdLines(t: Created, out: Output): string {
  const params = {
    n: t.number,
    title: t.title === null ? say("text_erased") : clean(t.title),
    risk: t.risk,
    state: t.state,
  };
  const lines = [out.mark("ok", MESSAGES.task_created?.(params).text ?? "")];
  if (!t.hasCriteria) {
    const next = MESSAGES.task_missing_criteria?.(params);
    lines.push(`  ${next?.text}: ${out.paint("accent", next?.next?.command ?? "")}`);
  }
  return `${lines.join("\n")}\n`;
}
