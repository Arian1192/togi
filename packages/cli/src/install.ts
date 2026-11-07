import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

/** Clona la etiqueta, instala las dependencias, escribe RELEASE y el lanzador, y activa el LaunchAgent. */
export async function install(home: string, tag: string, deps: InstallDeps): Promise<Installed> {
  if (!isValidTag(tag)) {
    throw usageError("invalid_option", {
      field: "<etiqueta>",
      detail: "una etiqueta sin «/» ni «..» y que no empiece por «-»",
      command: "togi install --help",
    });
  }
  if (deps.platform !== "darwin") throw new CliError("install_unsupported", 1);
  const { run, supportDir, agentsDir } = deps;
  const release = join(supportDir, "releases", tag);
  const tmp = join(supportDir, "releases", `.tmp-${tag}-${process.pid}`);
  const fail = (error: unknown): never => {
    throw new CliError("install_failed", 1, { detail: (error as Error).message });
  };

  let commit = readRelease(release)?.commit ?? "";
  if (!existsSync(release)) {
    mkdirSync(join(supportDir, "releases"), { recursive: true });
    try {
      const source =
        deps.source ?? (await run("git", ["-C", CODE_ROOT, "remote", "get-url", "origin"])).trim();
      await run("git", ["clone", "--quiet", "--depth", "1", "--branch", tag, "--", source, tmp]);
      commit = (await run("git", ["-C", tmp, "rev-parse", "HEAD"])).trim();
      // Sin scripts de dependencias: el SDK y el sandbox no los necesitan (comprobado en una instalación real).
      await run("pnpm", ["--dir", tmp, "install", "--frozen-lockfile", "--ignore-scripts"]);
      writeFileSync(join(tmp, RELEASE_FILE), `${JSON.stringify({ tag, commit })}\n`);
      renameSync(tmp, release);
    } catch (error) {
      rmSync(tmp, { recursive: true, force: true });
      return fail(error);
    }
  }

  // El lanzador es estable: `update` solo cambia a qué versión apunta.
  const launcher = join(supportDir, "bin", "togi");
  mkdirSync(join(supportDir, "bin"), { recursive: true });
  const entry = join(release, "packages", "cli", "bin", "togi.js");
  writeFileSync(launcher, `#!/bin/sh\nexec ${quote(deps.node)} ${quote(entry)} "$@"\n`);
  chmodSync(launcher, 0o755);

  const plist = plistPath(agentsDir);
  try {
    // Un daemon manual choca con el socket del que va a gestionar launchd.
    await stopDaemon(home);
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(plist, renderPlist({ node: deps.node, release, home, log: paths(home).log }), {
      mode: 0o600,
    });
    const domain = `gui/${deps.uid}`;
    await run("launchctl", ["bootout", `${domain}/${LABEL}`]).catch(() => "");
    await run("launchctl", ["bootstrap", domain, plist]);
  } catch (error) {
    rmSync(plist, { force: true });
    return fail(error);
  }
  return { tag, commit, release, launcher };
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
