import { MESSAGES, type Message, type MessageParams, unexpected } from "./messages.ts";
import type { Output } from "./output.ts";

/** Códigos de salida de la guía de estilo (0 = hecho). */
export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ErrorContext extends MessageParams {
  requestId?: string | undefined;
}

export class CliError extends Error {
  readonly exitCode: ExitCode;
  readonly code: string;
  readonly context: ErrorContext;
  /** Status HTTP de la respuesta, si el error viene de la API. */
  readonly status: number | undefined;

  constructor(code: string, exitCode: ExitCode, context: ErrorContext = {}, status?: number) {
    super(code);
    this.code = code;
    this.exitCode = exitCode;
    this.context = context;
    this.status = status;
  }
}

/** status HTTP → código de salida. Lo que no se reconoce es un error inesperado (1). */
function exitFor(status: number): ExitCode {
  if (status === 401) return 5;
  if (status === 404) return 7;
  if (status === 409 || status === 412) return 4;
  if (status === 422) return 3;
  if (status === 400) return 2;
  return 1;
}

/** Un `code` de la red solo se acepta con esta forma: así no llegan caracteres de control a la terminal. */
const SAFE_CODE = /^[a-z_]+$/;

/** Convierte un problem+json en un `CliError`. El texto libre (`detail`) no se usa nunca. */
export function fromProblem(status: number, body: unknown, context: ErrorContext): CliError {
  const code = (body as { code?: unknown } | null)?.code;
  const safe = typeof code === "string" && SAFE_CODE.test(code) ? code : `http_${status}`;
  return new CliError(safe, exitFor(status), context, status);
}

export const daemonUnavailable = (): CliError => new CliError("daemon_unavailable", 6);

export const usageError = (code: string, context: ErrorContext = {}): CliError =>
  new CliError(code, 2, context);

function message(error: CliError): Message {
  const known = MESSAGES[error.code];
  if (known !== undefined) return known(error.context);
  return unexpected(error.status ?? 0);
}

/** Texto para stderr: mensaje, siguiente paso y, en gris, `code · req id`. */
export function renderError(error: CliError, out: Output): string {
  const { text, next, warning } = message(error);
  const head = out.mark("error", warning === undefined ? text : `${text} ${warning}`);
  const lines = [head];
  if (next !== undefined) {
    const step =
      next.command === undefined
        ? next.label
        : `${next.label}: ${out.paint("accent", next.command)}`;
    lines.push(`  ${step}`);
  }
  const trace = error.context.requestId === undefined ? "" : ` · req ${error.context.requestId}`;
  lines.push(out.paint("muted", `  ${error.code}${trace}`));
  return `${lines.join("\n")}\n`;
}
