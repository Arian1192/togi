import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  encodeLine,
  FromWorker,
  type SessionOrder,
  type SessionOutcome,
  type TaskId,
} from "@togi/core";
import { redact } from "../redaction/redact.ts";
import type { AgentEventStore } from "../trajectory/agent-event-store.ts";

/** Lo único que el trabajador hereda del daemon (ADR-008 §4): ni el token ni TOGI_HOME ni la credencial. */
const ENV_ALLOWLIST = ["PATH"];
const STDERR_LINES = 20;
const STDERR_LINE_CHARS = 500;

export interface WorkerLauncherDeps {
  agentEvents: AgentEventStore;
  /** Ruta de `packages/worker/src/main.ts`: el daemon no importa el paquete del trabajador. */
  workerEntry: string;
  /** Espera a que el trabajador acabe tras `cancel` o tras su resultado, antes de matar su grupo. */
  graceMs?: number;
  /** Valores exactos que nunca deben llegar a `diagnostics`, como el token de togi. */
  scrub?: readonly string[];
  /** Solo para tests: sustituye la lista blanca del entorno del trabajador. */
  env?: Record<string, string>;
}

export interface LaunchResult {
  outcome: SessionOutcome;
  exitCode: number | null;
  durationMs: number;
  /** Eventos escritos en el agent-event-store: el valor que va en `session.ended`. */
  trajectoryEvents: number;
  /** Últimas líneas de stderr del trabajador, ya limpias de secretos. */
  diagnostics: string;
}

const allowlisted = (): Record<string, string> =>
  Object.fromEntries(
    ENV_ALLOWLIST.flatMap((k) => (process.env[k] === undefined ? [] : [[k, process.env[k]]])),
  );

/**
 * Lanza el trabajador como hijo, le pasa la sesión por la entrada estándar y escribe sus eventos con
 * el agent-event-store. El daemon impone el tope de tiempo y, pase lo que pase, no deja vivo el grupo
 * de procesos del trabajador.
 */
export function createWorkerLauncher(deps: WorkerLauncherDeps) {
  const grace = deps.graceMs ?? 2000;
  return {
    async run(order: SessionOrder, taskId: TaskId, signal?: AbortSignal): Promise<LaunchResult> {
      const started = Date.now();
      const child = spawn(process.execPath, [deps.workerEntry], {
        env: deps.env ?? allowlisted(),
        detached: true, // grupo propio: se mata entero con -pid
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exited = new Promise<void>((resolve) => {
        child.once("close", () => resolve());
        child.once("error", () => resolve());
      });
      child.stdin.on("error", () => {}); // el trabajador pudo morir antes de leer
      const killGroup = () => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        } catch {} // ya no queda nadie
      };
      const timers: NodeJS.Timeout[] = [];
      const killSoon = () => timers.push(setTimeout(killGroup, grace));

      let stopped: "timeout" | "cancelled" | undefined;
      const stop = (reason: "timeout" | "cancelled") => {
        stopped ??= reason;
        child.stdin.write(encodeLine({ type: "cancel" }));
        killSoon();
      };
      timers.push(setTimeout(() => stop("timeout"), order.spec.timeoutMs + grace));
      const onAbort = () => stop("cancelled");
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();

      let result: Extract<FromWorker, { type: "result" }> | undefined;
      let count = 0;
      let writeFailed = false;
      let queue = Promise.resolve(); // un evento tras otro: la cadena de hashes no admite carreras
      const stdout = createInterface({ input: child.stdout });
      const stdoutClosed = new Promise((resolve) => stdout.once("close", resolve));
      stdout.on("line", (line) => {
        queue = queue.then(async () => {
          let message: FromWorker;
          try {
            message = FromWorker.parse(JSON.parse(line));
          } catch {
            return; // basura: el trabajador solo habla el protocolo
          }
          if (message.type === "result" && message.sessionId === order.sessionId) {
            result = message;
            child.stdin.end(); // el trabajador termina al cerrarse su entrada
            killSoon();
          } else if (message.type === "event" && message.sessionId === order.sessionId) {
            try {
              await deps.agentEvents.append(order.sessionId, taskId, message.kind, message.payload);
              count++;
            } catch {
              writeFailed = true;
            }
          }
        });
      });

      const secrets = [
        ...(deps.scrub ?? []),
        ...(order.credential ? [order.credential.secret] : []),
      ];
      const tail: string[] = [];
      createInterface({ input: child.stderr }).on("line", (line) => {
        tail.push(redact(line, secrets).slice(0, STDERR_LINE_CHARS));
        if (tail.length > STDERR_LINES) tail.shift();
      });

      try {
        child.stdin.write(encodeLine(order));
        await exited;
        await stdoutClosed;
        await queue;
      } finally {
        for (const t of timers) clearTimeout(t);
        signal?.removeEventListener("abort", onAbort);
        killGroup();
      }
      const outcome: SessionOutcome =
        stopped ?? (writeFailed || result === undefined ? "failed" : result.outcome);
      return {
        outcome,
        exitCode: result?.exitCode ?? null,
        durationMs: Date.now() - started,
        trajectoryEvents: count,
        diagnostics: redact(tail.join("\n"), secrets),
      };
    },
  };
}
