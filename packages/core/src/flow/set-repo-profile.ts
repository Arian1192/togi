import { canonicalize } from "../integrity/canonicalize.ts";
import { payloadProblem } from "../model/domain-event.ts";
import type { Actor } from "../model/ids.ts";
import type { RepoProfile } from "../model/repo-profile.ts";
import type { NewEvent } from "../ports/event-store.ts";
import { type DomainError, domainError } from "./errors.ts";

/**
 * Decide un perfil nuevo para el repo (ADR-011 §5). Lo fija un humano: el perfil dice qué comandos
 * ejecuta el builder y qué no puede tocar, así que ningún agente lo cambia. `current` es el perfil
 * vigente (el del último `repo.profile_set`) o `null`. Repetir el mismo perfil no hace nada (`[]`).
 */
export function setRepoProfile(
  current: RepoProfile | null,
  repo: string,
  profile: unknown,
  actor: Actor,
  at: string,
): NewEvent[] | DomainError {
  if (actor.kind !== "human") {
    return domainError("actor_not_allowed", "el perfil del repo solo lo fija un humano");
  }
  const payload = { repo, profile };
  const problem = payloadProblem("repo.profile_set", payload);
  if (problem) return domainError("invalid_payload", problem);
  if (current !== null && canonicalize(current) === canonicalize(profile)) return [];
  return [{ schemaVersion: 1, actor, at, type: "repo.profile_set", payload }];
}
