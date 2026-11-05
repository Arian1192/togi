import { z } from "zod";
import { SpecialistSchema, specialistHash } from "../model/specialist.ts";
import type { NewEvent } from "../ports/event-store.ts";
import { type DomainError, domainError } from "./errors.ts";

/** Una versión ya publicada en el stream del especialista. */
export interface PublishedVersion {
  version: number;
  hash: string;
}

/**
 * Decide la publicación de una versión (ADR-009). Valida el formato, incluido que las herramientas
 * quepan en el rol. Cada versión es inmutable: repetir id y versión con el mismo contenido no hace
 * nada (`[]`); con otro contenido se rechaza.
 */
export function publishSpecialist(
  published: readonly PublishedVersion[],
  input: unknown,
  at: string,
): NewEvent[] | DomainError {
  const parsed = SpecialistSchema.safeParse(input);
  if (!parsed.success) return domainError("invalid_specialist", z.prettifyError(parsed.error));
  const specialist = parsed.data;
  const hash = specialistHash(specialist);
  const same = published.find((p) => p.version === specialist.version);
  if (same === undefined) {
    const actor = { kind: "system", component: "catalog" } as const;
    return [
      {
        schemaVersion: 1,
        actor,
        at,
        type: "specialist.version_published",
        payload: { specialist, hash },
      },
    ];
  }
  if (same.hash === hash) return [];
  return domainError(
    "specialist_version_conflict",
    `${specialist.id}@${specialist.version} ya está publicado con otro contenido; sube la versión de ${specialist.id}`,
  );
}
