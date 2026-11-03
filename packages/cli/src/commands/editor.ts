import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import { CliError } from "../errors.ts";

/**
 * Editor de `$VISUAL` o, si no, de `$EDITOR`, separado por espacios y sin shell: una ruta con
 * espacios no funciona. `undefined` si ninguno está definido.
 */
export function resolveEditor(env: Record<string, string | undefined>): string[] | undefined {
  for (const name of ["VISUAL", "EDITOR"]) {
    const parts = (env[name] ?? "").trim().split(/\s+/).filter(Boolean);
    if (parts.length > 0) return parts;
  }
  return undefined;
}

/**
 * Abre `content` en el editor y devuelve lo que queda en el fichero. El fichero contiene textos
 * descifrados: vive en una carpeta propia (0700), con modo 0600, y se borra siempre al terminar,
 * también si el editor falla o llega SIGTERM/SIGHUP. SIGINT se deja al editor, que lo recibe en el
 * mismo grupo de procesos. SIGKILL no se puede atrapar y deja el fichero.
 */
export async function runEditor(editor: string[], content: string): Promise<string> {
  const [command, ...args] = editor;
  if (command === undefined) throw new CliError("editor_failed", 1, { detail: "sin editor" });
  const dir = mkdtempSync(join(tmpdir(), "togi-edit-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  const file = join(dir, "tarea.md");
  const onSignal = (signal: NodeJS.Signals) => () => {
    child?.kill(signal);
    cleanup();
    process.exit(128 + (constants.signals[signal] ?? 0));
  };
  const onTerm = onSignal("SIGTERM");
  const onHup = onSignal("SIGHUP");
  const ignore = () => {};
  let child: ReturnType<typeof spawn> | undefined;
  process.on("exit", cleanup);
  process.on("SIGINT", ignore);
  process.on("SIGTERM", onTerm);
  process.on("SIGHUP", onHup);
  try {
    writeFileSync(file, content, { mode: 0o600, flag: "wx" });
    // El stdout del editor va a stderr: así funciona aunque el de la CLI sea una tubería.
    child = spawn(command, [...args, file], { stdio: ["inherit", 2, 2] });
    const exit = await new Promise<string | null>((resolve, reject) => {
      child?.once("error", reject);
      child?.once("close", (code, signal) => resolve(code === 0 ? null : String(code ?? signal)));
    }).catch((error: NodeJS.ErrnoException) => String(error.code ?? "error"));
    if (exit !== null) throw new CliError("editor_failed", 1, { detail: exit });
    return readFileSync(file, "utf8");
  } finally {
    process.off("exit", cleanup);
    process.off("SIGINT", ignore);
    process.off("SIGTERM", onTerm);
    process.off("SIGHUP", onHup);
    cleanup();
  }
}
