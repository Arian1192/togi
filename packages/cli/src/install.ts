import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { paths } from "@togi/daemon/config";
import { CODE_ROOT, isValidTag, RELEASE_FILE, readRelease } from "@togi/daemon/release";
import { CliError, usageError } from "./errors.ts";
import { LABEL, managesHome, plistPath, type Runner, renderPlist } from "./launchd.ts";
import { stopDaemon } from "./lifecycle.ts";

export interface InstallDeps {
  run: Runner;
  /** Donde viven las versiones y el lanzador: fuera de TOGI_HOME, que el sandbox no admite en runtimePaths. */
  supportDir: string;
  agentsDir: string;
  uid: number;
  node: string;
  platform: NodeJS.Platform;
  /** Origen del que se clona; sin él, el `origin` del código que se está ejecutando. */
  source?: string;
  /**
   * Cuánto esperar a que macOS quite el servicio tras un `bootout`, y cuánto reintentar un `bootstrap`
   * que da el error 5. Lo pone el comando real; sin él (los tests) no se espera ni se reintenta.
   */
  settle?: { pollMs: number; limitMs: number };
}

export const supportDirOf = (home: string = homedir()): string =>
  join(home, "Library", "Application Support", "togi");

export interface Installed {
  tag: string;
  commit: string;
  release: string;
  launcher: string;
}

const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const message = (error: unknown): string => (error as Error).message;
const readIfAny = (file: string): string | undefined => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
};

function check(tag: string, deps: InstallDeps, command: string): void {
  if (!isValidTag(tag)) {
    throw usageError("invalid_option", {
      field: "<etiqueta>",
      detail: "una etiqueta sin «/» ni «..» y que no empiece por «-»",
      command,
    });
  }
  if (deps.platform !== "darwin") throw new CliError("install_unsupported", 1);
}

const sourceOf = async (deps: InstallDeps): Promise<string> =>
  deps.source ?? (await deps.run("git", ["-C", CODE_ROOT, "remote", "get-url", "origin"])).trim();

/** El commit al que apunta ahora la etiqueta en el origen (el de una etiqueta anotada, no su objeto). */
async function tagCommit(tag: string, source: string, run: Runner): Promise<string | undefined> {
  const ref = `refs/tags/${tag}`;
  const out = await run("git", ["ls-remote", "--tags", "--", source, ref, `${ref}^{}`]);
  const shaOf = new Map<string, string>();
  for (const line of out.split("\n")) {
    const [sha, name] = line.split("\t");
    if (sha !== undefined && name !== undefined) shaOf.set(name, sha);
  }
  return shaOf.get(`${ref}^{}`) ?? shaOf.get(ref);
}

/**
 * Una carpeta de esa etiqueta que ya existe (un intento anterior) solo se reutiliza si su commit es el
 * que tiene la etiqueta ahora: las etiquetas se pueden mover. Si no, se niega, sin activar nada.
 */
async function reusable(tag: string, release: string, deps: InstallDeps): Promise<string> {
  const installed = readRelease(release)?.commit;
  const current = await tagCommit(tag, await sourceOf(deps), deps.run);
  const short = (c: string | undefined) => (c === undefined ? "ninguno" : c.slice(0, 7));
  const borrar = `borra la carpeta (rm -rf "${release}") y repite el comando`;
  if (current === undefined) {
    throw new Error(
      `La etiqueta ${tag} ya no existe en el origen, y ${release} sigue ahí.\nSi no la necesitas, ${borrar}.`,
    );
  }
  if (installed !== current) {
    throw new Error(
      `${release} es de otro commit (${short(installed)}) que la etiqueta ${tag} (${short(current)}); ` +
        `las etiquetas de versión no se reutilizan, así que no se activa nada.\n` +
        `Lo más limpio: publica una etiqueta nueva e instala esa.\n` +
        `Si de verdad quieres ${tag}: ${borrar}.`,
    );
  }
  return installed;
}

/** Clona la etiqueta, instala las dependencias y escribe RELEASE. Una versión ya instalada no se toca. */
async function fetchRelease(tag: string, deps: InstallDeps) {
  const { run, supportDir } = deps;
  const release = join(supportDir, "releases", tag);
  if (existsSync(release)) return { release, commit: await reusable(tag, release, deps) };
  const tmp = join(supportDir, "releases", `.tmp-${tag}-${process.pid}`);
  mkdirSync(join(supportDir, "releases"), { recursive: true });
  try {
    const source = await sourceOf(deps);
    await run("git", ["clone", "--quiet", "--depth", "1", "--branch", tag, "--", source, tmp]);
    const commit = (await run("git", ["-C", tmp, "rev-parse", "HEAD"])).trim();
    // Sin scripts de dependencias: el SDK y el sandbox no los necesitan (comprobado en una instalación real).
    await run("pnpm", ["--dir", tmp, "install", "--frozen-lockfile", "--ignore-scripts"]);
    writeFileSync(join(tmp, RELEASE_FILE), `${JSON.stringify({ tag, commit })}\n`);
    renameSync(tmp, release);
    return { release, commit };
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
}

const launcherOf = (deps: InstallDeps): string => join(deps.supportDir, "bin", "togi");

function writeLauncher(release: string, deps: InstallDeps): void {
  const launcher = launcherOf(deps);
  const entry = join(release, "packages", "cli", "bin", "togi.js");
  mkdirSync(join(deps.supportDir, "bin"), { recursive: true });
  writeFileSync(launcher, `#!/bin/sh\nexec ${quote(deps.node)} ${quote(entry)} "$@"\n`);
  chmodSync(launcher, 0o755);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** El error 5 de `launchctl bootstrap` justo después de un `bootout`: macOS aún no ha quitado el servicio. */
const STILL_REMOVING = /Bootstrap failed: 5\b|Input\/output error/;

/**
 * Descarga el servicio, espera (con tope) a que macOS lo haya quitado de verdad y lo carga, reintentando
 * si `bootstrap` da el error 5. Un `bootstrap` inmediato tras el `bootout` falla.
 */
async function reload(deps: InstallDeps, plist: string): Promise<void> {
  const domain = `gui/${deps.uid}`;
  const service = `${domain}/${LABEL}`;
  const { run, settle } = deps;
  await run("launchctl", ["bootout", service]).catch(() => "");
  if (settle === undefined) return void (await run("launchctl", ["bootstrap", domain, plist]));
  const end = Date.now() + settle.limitMs;
  while (Date.now() < end) {
    const present = await run("launchctl", ["print", service]).then(
      () => true,
      () => false,
    );
    if (!present) break;
    await sleep(settle.pollMs);
  }
  for (;;) {
    try {
      return void (await run("launchctl", ["bootstrap", domain, plist]));
    } catch (error) {
      if (!STILL_REMOVING.test(message(error)) || Date.now() >= end) throw error;
      await sleep(settle.pollMs);
    }
  }
}

/** Pone el lanzador y el plist apuntando a `release` y (re)carga el LaunchAgent. */
async function activate(home: string, release: string, deps: InstallDeps): Promise<void> {
  const { agentsDir } = deps;
  // Si launchd ya gestiona este daemon, lo para el `bootout`: `stopDaemon` solo conoce el que arrancó
  // `togi daemon start` (fichero de pid) y rechazaría el de launchd con daemon_pid_mismatch.
  const managed = managesHome(home, agentsDir);
  writeLauncher(release, deps);
  // Un daemon manual choca con el socket del que va a gestionar launchd.
  if (!managed) await stopDaemon(home);
  mkdirSync(agentsDir, { recursive: true });
  const plist = plistPath(agentsDir);
  writeFileSync(plist, renderPlist({ node: deps.node, release, home, log: paths(home).log }), {
    mode: 0o600,
  });
  await reload(deps, plist);
}

/** Instala la etiqueta y activa el LaunchAgent. */
export async function install(home: string, tag: string, deps: InstallDeps): Promise<Installed> {
  check(tag, deps, "togi install --help");
  try {
    const { release, commit } = await fetchRelease(tag, deps);
    try {
      await activate(home, release, deps);
    } catch (error) {
      rmSync(plistPath(deps.agentsDir), { force: true });
      throw error;
    }
    return { tag, commit, release, launcher: launcherOf(deps) };
  } catch (error) {
    throw new CliError("install_failed", 1, { detail: message(error) });
  }
}

/**
 * Instala la etiqueta nueva y reinicia el daemon con ella. La versión anterior no se toca. Si falla
 * la instalación, no cambia nada ni se reinicia; si falla al activarla, se restauran el plist y el
 * lanzador anteriores y se vuelve a cargar el agente.
 */
export async function update(home: string, tag: string, deps: InstallDeps): Promise<Installed> {
  check(tag, deps, "togi update --help");
  const plist = plistPath(deps.agentsDir);
  if (!existsSync(plist)) throw new CliError("not_installed", 1);
  let fetched: Awaited<ReturnType<typeof fetchRelease>>;
  try {
    fetched = await fetchRelease(tag, deps);
  } catch (error) {
    throw new CliError("update_failed", 1, { detail: message(error) });
  }
  const launcher = launcherOf(deps);
  const before = { plist: readFileSync(plist, "utf8"), launcher: readIfAny(launcher) };
  try {
    await activate(home, fetched.release, deps);
  } catch (error) {
    writeFileSync(plist, before.plist, { mode: 0o600 });
    if (before.launcher !== undefined) {
      writeFileSync(launcher, before.launcher);
      chmodSync(launcher, 0o755);
    }
    const restored = await reload(deps, plist).then(
      () => "Se restauró la versión anterior.",
      (e: unknown) =>
        `No se pudo reactivar la anterior: ${message(e)}\n` +
        `Arráncalo a mano con: launchctl bootstrap gui/${deps.uid} ${plist}`,
    );
    throw new CliError("update_failed", 1, { detail: `${message(error)}\n${restored}` });
  }
  return { tag, commit: fetched.commit, release: fetched.release, launcher };
}

/** Quita el LaunchAgent. No toca TOGI_HOME, las versiones instaladas ni el lanzador. */
export async function uninstall(deps: InstallDeps): Promise<{ removed: boolean }> {
  if (deps.platform !== "darwin") throw new CliError("install_unsupported", 1);
  const plist = plistPath(deps.agentsDir);
  if (!existsSync(plist)) return { removed: false };
  await deps.run("launchctl", ["bootout", `gui/${deps.uid}/${LABEL}`]).catch(() => "");
  rmSync(plist, { force: true });
  return { removed: true };
}
