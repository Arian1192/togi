import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, linkSync, mkdirSync, openSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MARK = "TOGI_RUN";
const PREFIX = ".togi-run-";
const scopeOf = (runDir: string) =>
  `h${createHash("sha1").update(runDir).digest("hex").slice(0, 8)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

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
 *
 * El fichero de marca tiene un enlace duro en `runDir` (`TOGI_HOME/run`, fuera del alcance del
 * sandbox): el mismo inodo con un segundo nombre. Si el agente borra su nombre, o el trabajador
 * muere con SIGKILL sin limpiar, `lsof` sigue encontrando a quien lo tenga abierto, sea o no un
 * binario de Apple, y `begin()` de la ejecución siguiente (aunque sea de otro trabajador) lo mata.
 */
export class Reaper implements RunReaper {
  readonly tag: string;
  readonly env: Record<string, string>;
  readonly #scope: string;
  readonly #file: string;
  readonly #link: string;
  readonly #runDir: string;
  readonly #fd: number;
  readonly #seen = new Set<number>();
  #timer: NodeJS.Timeout | undefined;

  constructor(dir: string, platform: string = process.platform, runDir?: string) {
    if (platform !== "darwin") {
      throw new Error(
        `Reaper solo funciona en macOS (usa ps -E y lsof de macOS), no en ${platform}`,
      );
    }
    // Sin dónde registrar la marca no hay limpieza fiable: se falla en vez de seguir sin ella.
    if (runDir === undefined) throw new Error("Reaper necesita runDir para registrar su marca");
    this.#runDir = runDir;
    // La marca de entorno se acota a este `run/`: otro TOGI_HOME en la misma máquina (otro daemon,
    // otro test) no barre a los escapados de este, ni este a los suyos.
    this.#scope = scopeOf(runDir);
    this.tag = `${process.pid}-${this.#scope}-${randomUUID()}`;
    this.env = { [MARK]: this.tag };
    mkdirSync(runDir, { recursive: true, mode: 0o700 });
    this.#file = join(dir, `${PREFIX}${this.tag}`);
    this.#link = join(runDir, `${PREFIX}${this.tag}`);
    this.#fd = openSync(this.#file, "w");
    try {
      linkSync(this.#file, this.#link); // mismo sistema de ficheros que `dir`, o falla
    } catch (e) {
      closeSync(this.#fd);
      throw e;
    }
  }

  /** Descriptor que el hijo hereda (stdio[3]). */
  get fd(): number {
    return this.#fd;
  }

  /** Mata lo que sobre de ejecuciones anteriores de este proceso o de un trabajador ya muerto. */
  async begin(): Promise<void> {
    await Reaper.sweepStale(this.tag, this.#scope);
    await this.#sweepMarks();
  }

  /**
   * Mata a quien tenga abierta la marca de otra ejecución. Se salta las marcas cuyo dueño es otro
   * trabajador vivo. Las de este proceso se vigilan hasta que muera (como hacía la lista en memoria);
   * las de un trabajador muerto se borran tras barrerlas, así `run/` no crece. Límite: si un
   * trabajador muerto tuvo un PID que hoy usa otro proceso vivo, su marca se salta y esa ejecución no
   * se barre (el mismo caso que la marca de entorno).
   */
  async #sweepMarks(): Promise<void> {
    const owners = readdirSync(this.#runDir)
      .filter((name) => name.startsWith(PREFIX) && name !== `${PREFIX}${this.tag}`)
      .map((name) => ({
        file: join(this.#runDir, name),
        owner: Number(/^\.togi-run-(\d+)-/.exec(name)?.[1]),
      }))
      .filter(({ owner }) => owner === process.pid || !alive(owner));
    for (const pid of await holders(owners.map((o) => o.file))) if (pid !== process.pid) kill(pid);
    for (const { file, owner } of owners) if (owner !== process.pid) rmSync(file, { force: true });
  }

  /** Sin `scope`, o con una marca sin ámbito (anterior a este cambio), se barre como siempre. */
  static async sweepStale(current: string, scope?: string): Promise<void> {
    const stale = (c: string) => {
      const m = new RegExp(`${MARK}=(\\d+)-(\\S+)`).exec(c);
      if (!m || `${m[1]}-${m[2]}` === current) return false;
      const other = /^(h[0-9a-f]{8})-/.exec(m[2] as string)?.[1];
      if (other !== undefined && other !== scope) return false; // de otro TOGI_HOME
      return Number(m[1]) === process.pid || !alive(Number(m[1]));
    };
    const pids = (await processes()).filter((p) => stale(p.command)).map((p) => p.pid);
    for (const pid of pids) if (pid !== process.pid) kill(pid);
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
    if (final) closeSync(this.#fd); // el enlace de runDir queda: la próxima ejecución lo barre
  }
}

function kill(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {} // ya había muerto
}
