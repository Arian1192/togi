import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MARK = "TOGI_RUN";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Ficheros de marca de ejecuciones anteriores de este proceso: quien los siga abriendo escapó. */
const previous: string[] = [];

const holders = async (files: readonly string[]): Promise<number[]> => {
  if (files.length === 0) return [];
  // lsof sale con 1 si alguno de los ficheros no está abierto, pero imprime los demás igualmente.
  const out = await run("/usr/sbin/lsof", ["-nP", "-t", "--", ...files]).then(
    (r) => r.stdout,
    (e: { stdout?: string }) => e.stdout ?? "",
  );
  return out.split("\n").filter(Boolean).map(Number);
};

interface Proc {
  pid: number;
  ppid: number;
  command: string;
}

async function processes(): Promise<Proc[]> {
  // -E añade el entorno al comando: la marca se ve aunque el proceso haya salido de su grupo.
  const { stdout } = await run("/bin/ps", ["-A", "-E", "-ww", "-o", "pid=,ppid=,command="], {
    maxBuffer: 256 * 1024 * 1024,
  });
  const out: Proc[] = [];
  for (const line of stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] as string });
  }
  return out;
}

/** La limpieza de una ejecución. SrtSandbox la recibe inyectada; los tests con srt simulado usan una simulada. */
export interface RunReaper {
  /** Variables que el hijo hereda como marca. */
  readonly env: Record<string, string>;
  /** Descriptor que el hijo hereda como marca, o "ignore" si no hay. */
  readonly fd: number | "ignore";
  /** Antes de lanzar el hijo: mata lo que escapó de ejecuciones anteriores. */
  begin(): Promise<void>;
  watch(rootPid: number): void;
  sweep(final?: boolean): Promise<void>;
}

/**
 * Todo lo que una ejecución crea muere con ella, aunque haya salido de su grupo con setsid y su
 * padre haya muerto (pasa a launchd, ppid 1). Capas: el árbol visto mientras corre, la marca de
 * entorno que hereda (`ps` solo la muestra en binarios que no son de Apple) y un fichero abierto que
 * hereda, que `lsof` encuentra en cualquier proceso. Un proceso hostil que las evada a todas sigue
 * dentro del Seatbelt: el riesgo que queda es el uso de la API con la clave (ADR-008).
 */
export class Reaper implements RunReaper {
  readonly tag = `${process.pid}-${randomUUID()}`;
  readonly env = { [MARK]: this.tag };
  readonly #file: string;
  readonly #fd: number;
  readonly #seen = new Set<number>();
  #timer: NodeJS.Timeout | undefined;

  constructor(dir: string, platform: string = process.platform) {
    if (platform !== "darwin") {
      throw new Error(
        `Reaper solo funciona en macOS (usa ps -E y lsof de macOS), no en ${platform}`,
      );
    }
    this.#file = join(dir, `.togi-run-${this.tag}`);
    this.#fd = openSync(this.#file, "w");
  }

  /** Descriptor que el hijo hereda (stdio[3]). */
  get fd(): number {
    return this.#fd;
  }

  /** Mata lo que sobre de ejecuciones anteriores de este proceso o de un trabajador ya muerto. */
  begin(): Promise<void> {
    return Reaper.sweepStale(this.tag);
  }

  static async sweepStale(current: string): Promise<void> {
    const stale = (c: string) => {
      const m = new RegExp(`${MARK}=(\\d+)-(\\S+)`).exec(c);
      if (!m || `${m[1]}-${m[2]}` === current) return false;
      return Number(m[1]) === process.pid || !alive(Number(m[1]));
    };
    const pids = (await processes()).filter((p) => stale(p.command)).map((p) => p.pid);
    for (const pid of [...pids, ...(await holders(previous))]) if (pid !== process.pid) kill(pid);
  }

  watch(rootPid: number): void {
    const sample = async () => {
      const all = await processes().catch(() => []);
      const children = new Map<number, number[]>();
      for (const p of all) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid]);
      // Lo que ya no existe sale del conjunto: así un PID reutilizado por otro proceso no se mata.
      const live = new Set(all.map((p) => p.pid));
      for (const pid of this.#seen) if (!live.has(pid)) this.#seen.delete(pid);
      const queue = [rootPid];
      for (let pid = queue.pop(); pid !== undefined; pid = queue.pop()) {
        this.#seen.add(pid);
        queue.push(...(children.get(pid) ?? []));
      }
    };
    this.#timer = setInterval(() => void sample(), 50);
  }

  /** Mata hasta que no quede nadie. Con `final`, además cierra el fichero de marca y lo deja vigilado. */
  async sweep(final = false): Promise<void> {
    clearInterval(this.#timer);
    for (let round = 0; round < 10; round++) {
      const marked = (await processes())
        .filter((p) => p.command.includes(`${MARK}=${this.tag}`))
        .map((p) => p.pid);
      const targets = new Set(
        [...this.#seen, ...marked, ...(await holders([this.#file]))].filter(
          (p) => p !== process.pid && alive(p),
        ),
      );
      if (targets.size === 0) break;
      for (const pid of targets) kill(pid);
      await sleep(20);
    }
    if (final) {
      closeSync(this.#fd);
      previous.push(this.#file); // vive en el directorio desechable; se vigila hasta el final del proceso
    }
  }
}

function kill(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {} // ya había muerto
}
