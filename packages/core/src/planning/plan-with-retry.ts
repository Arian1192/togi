import { randomBytes } from "node:crypto";
import { type PlanOutput, parsePlanOutput } from "./plan-output.ts";
import { buildPlannerPrompt, buildRetryPrompt, type PlannerPromptInput } from "./planner-prompt.ts";

export type PlanAttempt =
  | { ok: true; plan: PlanOutput; attempts: 1 | 2 }
  /** `invalid_plan` es el código que queda en `session.ended`; `error` es para el log del daemon. */
  | { ok: false; code: "invalid_plan"; error: string };

/**
 * Pide el plan, lo valida con el esquema estricto y, si no encaja, hace un único reintento con el
 * error. Si vuelve a fallar, la sesión acaba como `invalid_plan`. `run` devuelve el texto final del
 * agente; si lanza (fallo del agente, no del formato), el error se propaga sin reintentar.
 */
export async function planWithRetry(
  input: PlannerPromptInput,
  run: (prompt: string) => Promise<string>,
): Promise<PlanAttempt> {
  const nonce = input.nonce ?? randomBytes(16).toString("hex");
  const prompt = buildPlannerPrompt({ ...input, nonce });
  const first = parsePlanOutput(await run(prompt));
  if (first.ok) return { ok: true, plan: first.plan, attempts: 1 };
  const second = parsePlanOutput(await run(buildRetryPrompt(prompt, first.error, nonce)));
  if (second.ok) return { ok: true, plan: second.plan, attempts: 2 };
  return { ok: false, code: "invalid_plan", error: second.error };
}
