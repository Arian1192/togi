import { stripControl } from "../redaction/control-chars.ts";
import { redact } from "../redaction/redact.ts";

/**
 * El resultado de un fallo como texto legible para daemon.log: un `Error` con su nombre y mensaje, un
 * texto tal cual, un error de regla con su código y mensaje, y cualquier otra cosa como JSON. Todo
 * pasa por el detector de secretos y sin caracteres de control: lo que llega aquí puede venir de un
 * agente o de una excepción con rutas y valores.
 */
export function describeFailure(result: unknown): string {
  return stripControl(redact(textOf(result)));
}

function textOf(result: unknown): string {
  if (result === undefined) return "sin detalle";
  if (typeof result === "string") return result;
  if (result instanceof Error) return `${result.name}: ${result.message}`;
  const known = result as { code?: unknown; message?: unknown } | null;
  if (typeof known?.code === "string" && typeof known.message === "string") {
    return `${known.code}: ${known.message}`;
  }
  try {
    return JSON.stringify(result) ?? String(result);
  } catch {
    return String(result);
  }
}

const RETRY = (n: number) => `reintenta con togi plan retry ${n}`;

/**
 * Qué hacer ante un motivo de fallo, con el comando a mano. Son textos fijos: lo único que entra es el
 * número de la tarea y el nombre del repo registrado.
 */
export function nextStep(code: string, number: number, repo?: string): string | undefined {
  switch (code) {
    case "repo_not_registered":
      return `registra el repo con togi repo add ${repo ?? "<owner/repo>"} --path <ruta> y ${RETRY(number)}`;
    case "credential_missing":
      return `configura una credencial con togi auth set-api-key o togi auth use-subscription y ${RETRY(number)}`;
    case "sandbox_unavailable":
      return "el sandbox solo funciona en macOS: mira togi daemon status";
    case "budget_exceeded":
      return `sube TOGI_MAX_SESSION_COST_USD (máximo 20) y reinicia el daemon, o ${RETRY(number)}`;
    case "agent_failed":
      return `las líneas «agente:» dicen por qué falló; ${RETRY(number)}`;
    case "invalid_plan":
      return `el agente no propuso un plan válido: ${RETRY(number)}`;
    case "timeout":
    case "max_turns_exceeded":
    case "worker_died":
    case "planner_failed":
    case "planner_error":
    case "trajectory_write_failed":
      return RETRY(number);
    default:
      return undefined;
  }
}
