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
import { LABEL, plistPath, type Runner, renderPlist } from "./launchd.ts";
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

/** Clona la etiqueta, instala las dependencias y escribe RELEASE. Una versión ya instalada no se toca. */
async function fetchRelease(tag: string, deps: InstallDeps) {
  const { run, supportDir } = deps;
  const release = join(supportDir, "releases", tag);
  if (existsSync(release)) return { release, commit: readRelease(release)?.commit ?? "" };
  const tmp = join(supportDir, "releases", `.tmp-${tag}-${process.pid}`);
  mkdirSync(join(supportDir, "releases"), { recursive: true });
  try {
    const source =
      deps.source ?? (await run("git", ["-C", CODE_ROOT, "remote", "get-url", "origin"])).trim();
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

/** Pone el lanzador y el plist apuntando a `release` y (re)carga el LaunchAgent. */
async function activate(home: string, release: string, deps: InstallDeps): Promise<void> {
  const { run, agentsDir } = deps;
  writeLauncher(release, deps);
  // Un daemon manual choca con el socket del que va a gestionar launchd.
  await stopDaemon(home);
  mkdirSync(agentsDir, { recursive: true });
  const plist = plistPath(agentsDir);
  writeFileSync(plist, renderPlist({ node: deps.node, release, home, log: paths(home).log }), {
    mode: 0o600,
  });
  const domain = `gui/${deps.uid}`;
  await run("launchctl", ["bootout", `${domain}/${LABEL}`]).catch(() => "");
  await run("launchctl", ["bootstrap", domain, plist]);
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
    const domain = `gui/${deps.uid}`;
    await deps.run("launchctl", ["bootout", `${domain}/${LABEL}`]).catch(() => "");
    const restored = await deps.run("launchctl", ["bootstrap", domain, plist]).then(
      () => "Se restauró la versión anterior.",
      (e: unknown) => `No se pudo reactivar la anterior: ${message(e)}`,
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
