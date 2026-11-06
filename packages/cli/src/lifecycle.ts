import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { paths } from "@togi/daemon/config";
import { createClient } from "./client.ts";
import { cleanLogText } from "./daemon-logs.ts";
import { CliError } from "./errors.ts";

const POLL_MS = 100;
const LIMIT_MS = 10_000;
const DAEMON_MAIN = fileURLToPath(import.meta.resolve("@togi/daemon/main"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** El pid de `/v1/health`, o `undefined` si nadie escucha en el socket. */
export async function probe(home: string): Promise<number | undefined> {
  try {
    const client = createClient(home);
    const health = await client.checked<{ pid: number }>(await client.api.v1.health.$get());
    return health.pid;
  } catch (error) {
    if (error instanceof CliError && error.code === "daemon_unavailable") return undefined;
    throw error;
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Últimas líneas del log sin caracteres de control, para enseñarlas en el error. */
function logTail(file: string): string {
  try {
    const text = readFileSync(file, "utf8").split("\n").slice(-10).join("\n").slice(-2000);
    return cleanLogText(text).trim();
  } catch {
    return "";
  }
}

export type Started = { pid: number; already: boolean; socket: string };

export interface StartOptions {
  /** Programa que se lanza. Solo lo cambian los tests; el comando real usa el daemon. */
  daemon?: string;
  limitMs?: number;
}

export async function startDaemon(home: string, options: StartOptions = {}): Promise<Started> {
  const p = paths(home);
  const running = await probe(home);
  if (running !== undefined) return { pid: running, already: true, socket: p.socket };

  mkdirSync(p.runDir, { recursive: true, mode: 0o700 });
  const log = openSync(p.log, "a", 0o600);
  const child = spawn(process.execPath, [options.daemon ?? DAEMON_MAIN], {
    env: { ...process.env, TOGI_HOME: home },
    detached: true,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  let dead = false;
  child.once("exit", () => {
    dead = true;
  });
  child.once("error", () => {
    dead = true;
  });
  const pid = child.pid;
  if (pid !== undefined) writeFileSync(p.pid, `${pid}\n`, { mode: 0o600 });

  const deadline = Date.now() + (options.limitMs ?? LIMIT_MS);
  while (Date.now() < deadline) {
    if (dead || pid === undefined) {
      rmSync(p.pid, { force: true });
      throw new CliError("daemon_start_failed", 1, { detail: logTail(p.log) });
    }
    if ((await probe(home)) === pid) {
      child.unref();
      return { pid, already: false, socket: p.socket };
    }
    await sleep(POLL_MS);
  }
  child.kill("SIGTERM");
  rmSync(p.pid, { force: true });
  throw new CliError("daemon_start_timeout", 1);
}

/** Devuelve el pid parado, o `undefined` si no había daemon. */
export async function stopDaemon(home: string): Promise<number | undefined> {
  const p = paths(home);
  const pid = await probe(home);
  if (pid === undefined) {
    rmSync(p.pid, { force: true });
    return undefined;
  }
  let filePid = Number.NaN;
  try {
    filePid = Number.parseInt(readFileSync(p.pid, "utf8"), 10);
  } catch {}
  if (filePid !== pid) throw new CliError("daemon_pid_mismatch", 1, { pid });

  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + LIMIT_MS;
  while (alive(pid)) {
    if (Date.now() > deadline) throw new CliError("daemon_stop_timeout", 1, { pid });
    await sleep(POLL_MS);
  }
  rmSync(p.pid, { force: true });
  return pid;
}
