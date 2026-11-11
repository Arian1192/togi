import { dirname } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  encodeLine,
  FromWorker,
  type InstallOrder,
  type Sandbox,
  type SandboxResult,
  type SessionOrder,
  WorkerInput,
} from "@togi/core";
import { SrtSandbox } from "./sandbox/srt-sandbox.ts";

export interface WorkerDeps {
  createSandbox(order: SessionOrder | InstallOrder): Sandbox;
  /** Donde srt lee la credencial. Por defecto, el entorno de este proceso. */
  env?: NodeJS.ProcessEnv;
  heartbeatMs?: number;
  /** Donde cae la cola del stderr del agente; el lanzador la recoge. Por defecto, el de este proceso. */
  stderr?: Writable;
}

const STDERR_LINES = 20;
const STDERR_LINE_CHARS = 300;
const STDERR_HEAD_CHARS = 80;

/**
 * Una línea larga conserva su principio y su final con «…» en medio: el SDK imprime una línea de
 * código minificado y el mensaje real va al final, así que cortar por el final lo perdería.
 */
function shorten(line: string): string {
  if (line.length <= STDERR_LINE_CHARS) return line;
  const tail = STDERR_LINE_CHARS - STDERR_HEAD_CHARS - 1;
  return `${line.slice(0, STDERR_HEAD_CHARS)}…${line.slice(-tail)}`;
}

/**
 * Caracteres de control (escapes de terminal incluidos): el agente controla su stderr y el log se
 * lee en una terminal. Es la limpieza de la CLI sin la excepción del salto de línea, que aquí ya
 * separó las líneas.
 */
const CONTROL = /\p{Cc}/gu;

/**
 * Las últimas líneas del stderr del agente, sin la credencial. El lanzador las limpia otra vez con
 * el detector de secretos; esto solo evita que el valor exacto salga de este proceso.
 */
function stderrTail(stderr: string, secret: string | undefined, label = "agente"): string {
  const clean = secret ? stderr.split(secret).join("[credencial]") : stderr;
  const lines = clean.split("\n").filter((l) => l.trim() !== "");
  return lines
    .slice(-STDERR_LINES)
    .map((l) => `${label}: ${shorten(l.replace(CONTROL, ""))}\n`)
    .join("");
}

type Order = SessionOrder | InstallOrder;

export const srtSandbox = (order: Order): Sandbox =>
  new SrtSandbox({
    togiHome: dirname(order.workspacesRoot),
    runtimePaths: order.runtimePaths,
  });

/** El agente habla por su salida estándar: una línea JSON `{kind, payload}` por evento. */
function* events(sessionId: string, stdout: string): Generator<FromWorker> {
  for (const line of stdout.split("\n")) {
    let json: { kind?: unknown; payload?: unknown };
    try {
      json = JSON.parse(line);
    } catch {
      continue; // no es un mensaje del agente
    }
    const event = FromWorker.safeParse({ type: "event", sessionId, ...json });
    if (event.success) yield event.data;
  }
}

/** `usage.stop` del agente → motivo de parada. `ok` y lo desconocido no llevan motivo propio. */
const STOP_REASONS: Record<string, string> = {
  max_turns: "max_turns_exceeded",
  max_budget: "budget_exceeded",
  error: "agent_failed",
};

function stopReason(sessionId: string, stdout: string): string | undefined {
  let reason: string | undefined;
  for (const event of events(sessionId, stdout)) {
    if (event.type !== "event" || event.kind !== "usage") continue;
    const stop = (event.payload as { stop?: unknown } | null)?.stop;
    reason = typeof stop === "string" ? STOP_REASONS[stop] : undefined;
  }
  return reason;
}

/**
 * El trabajador (ADR-008 §4): una sesión a la vez, mensajes JSON por línea. La credencial llega
 * en la orden de la sesión, vive en memoria y está en el entorno solo mientras srt la usa. Los
 * errores son códigos fijos: nada de lo recibido se repite, porque puede llevar la credencial.
 */
export async function serve(input: Readable, output: Writable, deps: WorkerDeps): Promise<void> {
  const env = deps.env ?? process.env;
  const send = (message: FromWorker) => output.write(encodeLine(message));
  let running: { abort: AbortController; done: Promise<void> } | undefined;

  async function session(order: Order, signal: AbortSignal): Promise<void> {
    const started = Date.now();
    const beat = setInterval(() => send({ type: "heartbeat" }), deps.heartbeatMs ?? 5000);
    let outcome: "completed" | "failed" | "timeout" | "cancelled" = "failed";
    let exitCode: number | null = null;
    let failureReason: string | undefined;
    // La instalación no tiene agente: ni credencial ni entrada, y su stdout no son eventos.
    const agent = order.type === "session" ? order : undefined;
    const credential = agent?.credential ?? undefined;
    try {
      if (credential) env[credential.name] = credential.secret;
      const result: SandboxResult = await deps
        .createSandbox(order)
        .run(order.spec, order.argv, agent?.input, signal);
      if (agent) for (const event of events(order.sessionId, result.stdout)) send(event);
      if (result.exitCode !== 0 || result.timedOut) {
        (deps.stderr ?? process.stderr).write(
          agent
            ? stderrTail(result.stderr, credential?.secret)
            : stderrTail(`${result.stdout}\n${result.stderr}`, undefined, "instalación"),
        );
      }
      exitCode = result.exitCode;
      outcome = result.timedOut ? "timeout" : result.exitCode === 0 ? "completed" : "failed";
      if (outcome === "failed" && agent) failureReason = stopReason(order.sessionId, result.stdout);
    } catch {
      // Un agente que falla devuelve un código de salida; lo que lanza es el sandbox, que no pudo
      // arrancar (plataforma no soportada, especificación rechazada). Nunca se ejecuta sin él.
      failureReason = "sandbox_unavailable";
    } finally {
      // sin detalle: el mensaje de un error puede llevar la credencial
      if (credential) delete env[credential.name];
      clearInterval(beat);
    }
    if (signal.aborted) outcome = "cancelled";
    send({
      type: "result",
      sessionId: order.sessionId,
      outcome,
      exitCode,
      durationMs: Date.now() - started,
      ...(outcome === "failed" && failureReason !== undefined ? { failureReason } : {}),
    });
  }

  for await (const line of createInterface({ input })) {
    const parsed = WorkerInput.safeParse(safeJson(line));
    if (!parsed.success) {
      send({ type: "error", code: "invalid_message" });
    } else if (parsed.data.type === "cancel") {
      running?.abort.abort();
    } else if (running) {
      send({ type: "error", code: "busy" });
    } else {
      const abort = new AbortController();
      const done = session(parsed.data, abort.signal).finally(() => {
        running = undefined;
      });
      running = { abort, done };
    }
  }
  running?.abort.abort();
  await running?.done;
}

function safeJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
