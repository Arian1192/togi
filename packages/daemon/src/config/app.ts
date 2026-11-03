import { homedir } from "node:os";
import { join } from "node:path";

/** Única fuente del nombre, del prefijo de variables de entorno y del directorio de datos (ADR-006). */
export const APP = { name: "togi", envPrefix: "TOGI_", dataDirName: ".togi" } as const;

export const HOME_ENV = `${APP.envPrefix}HOME`;
export const KEYCHAIN_ENV = `${APP.envPrefix}KEYCHAIN`;

export function resolveHome(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  return env[HOME_ENV] ?? join(home, APP.dataDirName);
}

export function paths(root: string) {
  const runDir = join(root, "run");
  return {
    root,
    database: join(root, `${APP.name}.db`),
    runDir,
    socket: join(runDir, `${APP.name}.sock`),
    pid: join(runDir, `${APP.name}.pid`),
    log: join(runDir, "daemon.log"),
    credentials: join(root, "credentials"),
    blobs: join(root, "blobs"),
  };
}
