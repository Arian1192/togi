import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describeFailure } from "../orchestrator/describe-failure.ts";

export interface Notification {
  title: string;
  message: string;
}

/** Lanza `osascript` con estos argumentos; rechaza si falla. */
export type RunOsascript = (args: string[]) => Promise<unknown>;

/**
 * Script fijo: no contiene nunca texto de la notificación, que viaja solo como argumento (item 1 =
 * título, item 2 = mensaje). Las notificaciones solo llevan el número de la tarea, un código y un
 * comando (nunca su título, que va cifrado: ADR-004), pero el script constante sigue siendo la
 * defensa si algún día se les añade texto.
 */
export const SCRIPT =
  "on run argv\n  display notification (item 2 of argv) with title (item 1 of argv)\nend run";

const execFileAsync = promisify(execFile);
const osascript: RunOsascript = (args) => execFileAsync("osascript", args, { timeout: 10_000 });

export interface NotifierDeps {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  run?: RunOsascript;
  log?: (line: string) => void;
}

/**
 * Avisos de macOS. Nunca lanza ni espera: notificar no puede estorbar a quien lo pide. Fuera de macOS
 * no hace nada y lo anota una sola vez; `TOGI_NOTIFY=off` lo desactiva sin ruido.
 */
export function createNotifier({
  platform = process.platform,
  env = process.env,
  run = osascript,
  log = console.error,
}: NotifierDeps = {}) {
  let warned = false;
  return {
    notify({ title, message }: Notification): void {
      if (env.TOGI_NOTIFY === "off") return;
      if (platform !== "darwin") {
        if (!warned) log("notificaciones no disponibles fuera de macOS");
        warned = true;
        return;
      }
      const failed = (error: unknown) =>
        log(`no se pudo enviar la notificación: ${describeFailure(error)}`);
      try {
        run(["-e", SCRIPT, "--", title, message]).catch(failed);
      } catch (error) {
        failed(error);
      }
    },
  };
}
