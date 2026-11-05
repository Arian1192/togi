import { dirname } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  encodeLine,
  FromWorker,
  type Sandbox,
  type SandboxResult,
  type SessionOrder,
  ToWorker,
} from "@togi/core";
import { SrtSandbox } from "./sandbox/srt-sandbox.ts";

export interface WorkerDeps {
  createSandbox(order: SessionOrder): Sandbox;
  /** Donde srt lee la credencial. Por defecto, el entorno de este proceso. */
  env?: NodeJS.ProcessEnv;
  heartbeatMs?: number;
}

export const srtSandbox = (order: SessionOrder): Sandbox =>
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

/**
 * El trabajador (ADR-008 §4): una sesión a la vez, mensajes JSON por línea. La credencial llega
 * en la orden de la sesión, vive en memoria y está en el entorno solo mientras srt la usa. Los
 * errores son códigos fijos: nada de lo recibido se repite, porque puede llevar la credencial.
 */
export async function serve(input: Readable, output: Writable, deps: WorkerDeps): Promise<void> {
  const env = deps.env ?? process.env;
  const send = (message: FromWorker) => output.write(encodeLine(message));
  let running: { abort: AbortController; done: Promise<void> } | undefined;

  async function session(order: SessionOrder, signal: AbortSignal): Promise<void> {
    const started = Date.now();
    const beat = setInterval(() => send({ type: "heartbeat" }), deps.heartbeatMs ?? 5000);
    let outcome: "completed" | "failed" | "timeout" | "cancelled" = "failed";
    let exitCode: number | null = null;
    try {
      if (order.credential) env[order.credential.name] = order.credential.secret;
      const result: SandboxResult = await deps
        .createSandbox(order)
        .run(order.spec, order.argv, order.input, signal);
      for (const event of events(order.sessionId, result.stdout)) send(event);
      exitCode = result.exitCode;
      outcome = result.timedOut ? "timeout" : result.exitCode === 0 ? "completed" : "failed";
    } catch {
    } finally {
      // sin detalle: el mensaje de un error puede llevar la credencial
      if (order.credential) delete env[order.credential.name];
      clearInterval(beat);
    }
    if (signal.aborted) outcome = "cancelled";
    send({
      type: "result",
      sessionId: order.sessionId,
      outcome,
      exitCode,
      durationMs: Date.now() - started,
    });
  }

  for await (const line of createInterface({ input })) {
    const parsed = ToWorker.safeParse(safeJson(line));
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
