import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import {
  commandArgv,
  encodeLine,
  FromWorker,
  type InstallOrder,
  type RepoProfile,
} from "@togi/core";
import { redact } from "../redaction/redact.ts";
import { type ClonePaths, unlock } from "./task-clone.ts";

const OUTPUT_LINES = 20;
const OUTPUT_LINE_CHARS = 500;

export interface InstallRequest {
  /** El clon de la tarea (`createTaskClone`). */
  paths: ClonePaths;
  profile: Pick<RepoProfile, "install" | "registry">;
  /** Lo que el sandbox deja leer para ejecutar el comando (Node, el gestor de paquetes). */
  runtimePaths: readonly string[];
  timeoutMs: number;
}

/**
 * El resultado cerrado de la instalación. `output` es la cola de lo que imprimió, que es código del
 * repo: texto no fiable, acotado y limpio, que nunca se interpreta.
 */
export type InstallResult = (
  | { status: "ok" | "timeout" | "sandbox_error" }
  | { status: "failed"; exitCode: number | null }
) & { output: string };

/**
 * La orden para el trabajador (ADR-011 §4): el comando del perfil partido sin shell, escribiendo en
 * el árbol del clon y en el bloqueo de pnpm, con red solo al registro del perfil y sin credenciales.
 * `HOME` y `TMPDIR` van en una carpeta desechable junto al árbol, que no sale en el diff.
 */
export function installOrder(request: InstallRequest, sessionId: string): InstallOrder {
  const dir = dirname(request.paths.tree);
  return {
    type: "install",
    sessionId,
    spec: {
      readPaths: [],
      writeDir: join(dir, "install"),
      workTree: request.paths.tree,
      pnpmLocks: true,
      allowedDomains: [...request.profile.registry],
      allowedEnv: ["PATH"],
      credentials: [],
      timeoutMs: request.timeoutMs,
    },
    workspacesRoot: dirname(dir),
    runtimePaths: [...request.runtimePaths],
    argv: commandArgv(request.profile.install),
  };
}

/**
 * Ejecuta la instalación en el trabajador, en un paso propio sin agente. No escribe trayectoria: no
 * tiene dónde, y los mensajes `event` se descartan. Lo que no es un resultado limpio del trabajador
 * es `sandbox_error`. El daemon impone el tope de tiempo y no deja vivo el grupo del trabajador.
 */
export function createInstallRunner(deps: { workerEntry: string; graceMs?: number }) {
  const grace = deps.graceMs ?? 2000;
  return {
    async run(request: InstallRequest): Promise<InstallResult> {
      let order: InstallOrder;
      try {
        order = installOrder(request, `ins_${randomUUID()}`);
        const scratch = order.spec.writeDir;
        await unlock(scratch).catch(() => undefined); // una instalación anterior pudo dejar 0555
        await rm(scratch, { recursive: true, force: true });
        await mkdir(scratch, { mode: 0o700 });
      } catch {
        return { status: "sandbox_error", output: "" };
      }
      const child = spawn(process.execPath, [deps.workerEntry], {
        env: process.env.PATH === undefined ? {} : { PATH: process.env.PATH },
        detached: true, // grupo propio: se mata entero con -pid
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exited = new Promise((resolve) => {
        child.once("close", resolve);
        child.once("error", resolve);
      });
      child.stdin.on("error", () => {});
      const killGroup = () => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        } catch {} // ya no queda nadie
      };
      const timers: NodeJS.Timeout[] = [];
      const finish = () => {
        child.stdin.end(); // el trabajador termina al cerrarse su entrada
        timers.push(setTimeout(killGroup, grace));
      };
      let timedOut = false;
      const limit = setTimeout(() => {
        timedOut = true;
        child.stdin.write(encodeLine({ type: "cancel" }));
        finish();
      }, order.spec.timeoutMs + grace);

      let result: Extract<FromWorker, { type: "result" }> | undefined;
      createInterface({ input: child.stdout }).on("line", (line) => {
        let message: FromWorker;
        try {
          message = FromWorker.parse(JSON.parse(line));
        } catch {
          return;
        }
        if (result !== undefined || timedOut) return;
        if (message.type === "result" && message.sessionId === order.sessionId) {
          result = message;
          clearTimeout(limit); // ya contestó: el tope no puede convertirlo en timeout
          finish();
        } else if (message.type === "error") finish(); // no va a contestar a esta orden
      });
      const tail: string[] = [];
      createInterface({ input: child.stderr }).on("line", (line) => {
        tail.push(redact(line).slice(0, OUTPUT_LINE_CHARS));
        if (tail.length > OUTPUT_LINES) tail.shift();
      });

      try {
        child.stdin.write(encodeLine(order));
        await exited;
      } finally {
        for (const t of [limit, ...timers]) clearTimeout(t);
        killGroup();
      }
      const output = tail.join("\n");
      if (timedOut || result?.outcome === "timeout") return { status: "timeout", output };
      if (result?.outcome === "completed") return { status: "ok", output };
      if (result?.outcome === "failed" && result.failureReason !== "sandbox_unavailable") {
        return { status: "failed", exitCode: result.exitCode, output };
      }
      return { status: "sandbox_error", output };
    },
  };
}
