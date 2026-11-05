import { type ChildProcessByStdio, spawn } from "node:child_process";
import { homedir } from "node:os";
import type { Readable, Writable } from "node:stream";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { Sandbox, SandboxResult, SandboxSpec } from "@togi/core";
import { Reaper, type RunReaper } from "./reap.ts";
import { SandboxSpecError, toSrtConfig } from "./srt-config.ts";

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** Lo que SrtSandbox usa de srt; se puede sustituir en los tests. */
export interface SrtManager {
  isSupportedPlatform(): boolean;
  initialize(config: SandboxRuntimeConfig): Promise<void>;
  wrapWithSandboxArgv(command: string): Promise<{ argv: string[] }>;
  reset(): Promise<void>;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * srt es un singleton por proceso y lee el valor real de las credenciales de process.env del
 * proceso que lo llama: el trabajador debe tenerlas ahí. El hijo recibe un entorno propio.
 */
export class SrtSandbox implements Sandbox {
  readonly #togiHome: string;
  readonly #home: string;
  readonly #runtimePaths: readonly string[];
  readonly #manager: SrtManager;
  readonly #newReaper: (dir: string) => RunReaper;

  /** `runtimePaths`: Node y el código del agente. Los pone quien construye el sandbox, nunca la especificación. */
  constructor(opts: {
    togiHome: string;
    runtimePaths: readonly string[];
    home?: string;
    manager?: SrtManager;
    /** Por defecto, el real: no hay camino de producción sin limpieza. */
    reaper?: (dir: string) => RunReaper;
  }) {
    this.#togiHome = opts.togiHome;
    this.#home = opts.home ?? homedir();
    this.#runtimePaths = opts.runtimePaths;
    this.#manager = opts.manager ?? SandboxManager;
    this.#newReaper = opts.reaper ?? ((dir) => new Reaper(dir));
  }

  run(
    spec: SandboxSpec,
    argv: readonly string[],
    input?: string,
    signal?: AbortSignal,
  ): Promise<SandboxResult> {
    const result = queue.then(() => this.#run(spec, argv, input, signal));
    queue = result.catch(() => undefined);
    return result;
  }

  async #run(
    spec: SandboxSpec,
    argv: readonly string[],
    input: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<SandboxResult> {
    const config = toSrtConfig(spec, {
      home: this.#home,
      togiHome: this.#togiHome,
      runtimePaths: this.#runtimePaths,
    });
    if (argv.length === 0) throw new SandboxSpecError("argv está vacío");
    if (!this.#manager.isSupportedPlatform()) {
      throw new SandboxSpecError("srt no está soportado en esta plataforma");
    }
    await this.#manager.initialize(config);
    try {
      const wrapped = await this.#manager.wrapWithSandboxArgv(argv.map(quote).join(" "));
      const env: Record<string, string> = {};
      for (const name of spec.allowedEnv) {
        const value = process.env[name];
        if (value !== undefined) env[name] = value;
      }
      env.HOME = spec.writeDir;
      env.TMPDIR = spec.writeDir;
      return await execute(wrapped.argv, env, spec, input, signal, this.#newReaper(spec.writeDir));
    } finally {
      await this.#manager.reset();
    }
  }
}

async function execute(
  argv: string[],
  env: Record<string, string>,
  spec: SandboxSpec,
  input: string | undefined,
  signal: AbortSignal | undefined,
  reaper: RunReaper,
): Promise<SandboxResult> {
  // Antes de empezar: un escapado de una sesión anterior podría usar la pasarela de esta.
  await reaper.begin();
  Object.assign(env, reaper.env);
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = argv;
    // Grupo de procesos propio: al terminar se mata el grupo entero, nietos incluidos.
    const child = spawn(cmd as string, args, {
      cwd: spec.writeDir,
      env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe", reaper.fd], // el cuarto es la marca que hereda el agente
    }) as ChildProcessByStdio<Writable, Readable, Readable>;
    const killGroup = () => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {} // el grupo ya no existe
    };
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let done = false;
    const finish = async (exitCode: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      killGroup();
      await reaper.sweep(true);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ exitCode, stdout, stderr, timedOut });
    };
    signal?.addEventListener("abort", () => {
      killGroup();
      void finish(null);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
      // No se espera a que se cierren las tuberías: basta con que el proceso haya muerto.
      if (child.exitCode !== null || child.signalCode !== null) void finish(child.exitCode);
      else child.once("exit", (code) => void finish(code));
    }, spec.timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (e) => {
      done = true;
      clearTimeout(timer);
      void reaper.sweep(true);
      reject(e);
    });
    child.on("close", (exitCode) => void finish(exitCode));
    child.stdin.on("error", () => {}); // el hijo pudo morir antes de leer la entrada
    child.stdin.end(input ?? "");
  });
}
