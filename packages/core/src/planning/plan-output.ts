import { z } from "zod";
import { planContentShape } from "../model/domain-event.ts";

/**
 * Lo que devuelve el planificador: el contenido estricto del plan del PR 1 y el enfoque como texto
 * (el daemon lo guarda en un blob). `baseSha` y la versión no los pone el agente.
 */
export const PlanOutputSchema = z.strictObject({
  ...planContentShape,
  approach: z.string().min(1),
});
export type PlanOutput = z.infer<typeof PlanOutputSchema>;

const MAX_ERROR_LENGTH = 1000;
const FENCE = /```(?:json)?\s*\n([\s\S]*?)\n```/g;

/** El último bloque ```json de la respuesta; si no hay, la respuesta entera. */
function extractJson(text: string): string {
  const blocks = [...text.matchAll(FENCE)];
  return (blocks.at(-1)?.[1] ?? text).trim();
}

/**
 * Valida la respuesta del agente con el esquema estricto. El error vuelve al agente en el
 * reintento: se acota en tamaño porque puede citar claves que escribió el propio agente.
 */
export function parsePlanOutput(
  text: string,
): { ok: true; plan: PlanOutput } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch {
    return { ok: false, error: "la respuesta no es un JSON válido" };
  }
  const parsed = PlanOutputSchema.safeParse(json);
  if (parsed.success) return { ok: true, plan: parsed.data };
  return { ok: false, error: z.prettifyError(parsed.error).slice(0, MAX_ERROR_LENGTH) };
}
