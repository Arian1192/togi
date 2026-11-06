import { execFile } from "node:child_process";
import { join } from "node:path";

const BIN = join(import.meta.dirname, "..", "..", "bin", "togi.js");

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Ejecuta la CLI como proceso, con `TOGI_HOME` temporal y sin `NO_COLOR`/`FORCE_COLOR` heredados. */
export function runCli(
  args: string[],
  home: string,
  env: Record<string, string> = {},
  /** Lo que recibe la entrada estándar; sin él, queda abierta como hasta ahora. */
  input?: string,
  /** Directorio desde el que se ejecuta; sin él, el del proceso de test. */
  cwd?: string,
): Promise<CliResult> {
  const base: Record<string, string | undefined> = {
    ...process.env,
    TOGI_HOME: home,
    TOGI_KEYCHAIN: "file",
    LANG: "es_ES.UTF-8",
  };
  delete base.NO_COLOR;
  delete base.FORCE_COLOR;
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [BIN, ...args],
      { env: { ...base, ...env }, ...(cwd === undefined ? {} : { cwd }) },
      (error, stdout, stderr) => {
        resolve({
          code: error === null ? 0 : ((error as { code?: number }).code ?? 1),
          stdout,
          stderr,
        });
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}
