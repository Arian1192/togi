import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";

const BIN = join(import.meta.dirname, "..", "..", "bin", "togi.js");

export interface RunningCli {
  child: ChildProcess;
  stdout(): string;
  stderr(): string;
  /** Código de salida cuando el proceso termina. */
  exit: Promise<number | null>;
}

/** Como `runCli`, pero devuelve el proceso vivo: para comandos que no terminan (`togi watch`). */
export function spawnCli(args: string[], home: string): RunningCli {
  const env: Record<string, string | undefined> = {
    ...process.env,
    TOGI_HOME: home,
    TOGI_KEYCHAIN: "file",
    LANG: "es_ES.UTF-8",
  };
  delete env.NO_COLOR;
  delete env.FORCE_COLOR;
  const child = spawn(process.execPath, [BIN, ...args], { env });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exit = new Promise<number | null>((resolve) => child.once("close", resolve));
  return { child, stdout: () => stdout, stderr: () => stderr, exit };
}
