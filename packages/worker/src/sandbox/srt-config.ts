import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { SandboxSpec } from "@togi/core";

export class SandboxSpecError extends Error {
  override name = "SandboxSpecError";
}

export interface SrtContext {
  /** Carpeta personal del usuario. */
  home: string;
  /** TOGI_HOME. */
  togiHome: string;
  /** Rutas del entorno de ejecución (Node, código del agente). Las pone quien construye el sandbox. */
  runtimePaths: readonly string[];
  /** Carpetas temporales del usuario que se deniegan; sin él, las de este Mac. Los tests lo fijan. */
  tmpDirs?: readonly string[];
  /** Usuario del bloqueo de pnpm; sin él, el de este proceso. Los tests lo fijan. */
  uid?: number;
}

/**
 * Donde pnpm escribe siempre su bloqueo, sin hacer caso a TMPDIR (prueba de promos del ADR-011 §2).
 * Es lo único de /tmp que puede escribir la instalación, y nadie más.
 */
export const pnpmLockDir = (uid: number): string =>
  `/private/tmp/pnpm-store-operation-locks-${uid}`;

/** Fuera de la carpeta personal, el resto del Mac se lee salvo que se deniegue (ADR-008). */
const DENIED_OUTSIDE_HOME = ["/Users", "/Volumes", "/private/tmp"];

/**
 * La carpeta temporal del usuario. En /var/folders/xx/yyyy el `T/` va junto a `C/` (cachés de otras
 * aplicaciones) y `0/`, así que se deniega el padre entero. Sin `path`, en macOS se pregunta al
 * sistema y no solo a TMPDIR: el trabajador corre sin él y entonces tmpdir() dice /tmp. Si TMPDIR
 * apunta a otro sitio, se deniega también.
 */
export function userTmpDirs(path?: string): string[] {
  if (path !== undefined) return parentOfT(path);
  const fromSystem = process.platform === "darwin" ? parentOfT(darwinUserTempDir()) : [];
  return [...new Set([...fromSystem, ...parentOfT(tmpdir())])];
}

function parentOfT(path: string): string[] {
  const tmp = realpathSync(path);
  const parent = dirname(tmp);
  return basename(tmp) === "T" && parent.startsWith("/private/var/folders/") ? [parent] : [tmp];
}

/** La temporal que macOS asigna al usuario, sin depender del entorno; si no se sabe, no hay sandbox. */
function darwinUserTempDir(): string {
  try {
    const dir = execFileSync("/usr/bin/getconf", ["DARWIN_USER_TEMP_DIR"], {
      encoding: "utf8",
      env: {},
    }).trim();
    if (!isAbsolute(dir)) throw new Error(dir);
    return dir;
  } catch {
    throw new SandboxSpecError("no se pudo saber la carpeta temporal del usuario");
  }
}

/**
 * Lo que se deniega de lectura, siempre en el mismo orden y sin duplicados: la carpeta personal, las
 * rutas fijas, las temporales del usuario y /tmp. Una temporal que fuera la raíz del disco (TMPDIR=/)
 * denegaría todo, así que se rechaza.
 */
export function deniedRead(home: string, tmpDirs: readonly string[]): string[] {
  const tmp = tmpDirs.map(real);
  for (const p of tmp) {
    if (p === parse(p).root) throw new SandboxSpecError(`la carpeta temporal es la raíz: ${p}`);
  }
  return [...new Set([home, ...DENIED_OUTSIDE_HOME, ...tmp, real("/tmp")])];
}

const LABEL = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
const DOMAIN = new RegExp(`^${LABEL}(\\.${LABEL})+$`);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const GLOB = /[*?[\]{}]/;

function within(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function validDomain(d: string): boolean {
  return d.length <= 253 && DOMAIN.test(d) && !/^\d+$/.test(d.slice(d.lastIndexOf(".") + 1));
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function realExisting(path: string, what: string): string {
  if (!isAbsolute(path)) throw new SandboxSpecError(`${what}: la ruta no es absoluta: ${path}`);
  if (GLOB.test(path)) throw new SandboxSpecError(`${what}: la ruta tiene un patrón: ${path}`);
  if (path.split(sep).includes("..")) throw new SandboxSpecError(`${what}: la ruta tiene «..»`);
  try {
    return realpathSync(path);
  } catch {
    throw new SandboxSpecError(`${what}: la ruta no existe: ${path}`);
  }
}

/** Traduce la especificación a la configuración de srt, o se niega con SandboxSpecError. */
export function toSrtConfig(spec: SandboxSpec, ctx: SrtContext): SandboxRuntimeConfig {
  if (!Number.isInteger(spec.timeoutMs) || spec.timeoutMs <= 0) {
    throw new SandboxSpecError(`timeoutMs debe ser un entero positivo: ${spec.timeoutMs}`);
  }
  if (spec.readPaths.length === 0 && spec.workTree === undefined)
    throw new SandboxSpecError("readPaths está vacío");

  const home = real(ctx.home);
  const togiHome = real(ctx.togiHome);
  const workspaces = join(togiHome, "workspaces");

  // Lo que llega en la especificación solo puede estar bajo TOGI_HOME/workspaces/.
  const workspacePath = (given: string, what: string): string => {
    const p = realExisting(given, what);
    if (p === workspaces || !within(workspaces, p)) {
      throw new SandboxSpecError(`${what}: solo se admite lo que está bajo workspaces/: ${p}`);
    }
    return p;
  };
  // El entorno de ejecución puede estar en la carpeta personal (nvm), pero no ensancharla.
  const runtimePath = (given: string): string => {
    const p = realExisting(given, "runtimePaths");
    if (within(p, home) || within(p, togiHome) || within(togiHome, p)) {
      throw new SandboxSpecError(
        `runtimePaths: es la carpeta personal, TOGI_HOME o está dentro: ${p}`,
      );
    }
    return p;
  };

  const readPaths = spec.readPaths.map((p) => workspacePath(p, "readPaths"));
  const writeDir = workspacePath(spec.writeDir, "writeDir");
  const runtimePaths = ctx.runtimePaths.map(runtimePath);
  if (readPaths.some((r) => within(r, writeDir))) {
    throw new SandboxSpecError("writeDir está dentro de readPaths");
  }
  const writable = [writeDir];
  if (spec.workTree !== undefined) {
    const tree = workspacePath(spec.workTree, "workTree");
    if (
      within(tree, writeDir) ||
      within(writeDir, tree) ||
      readPaths.some((r) => within(r, tree))
    ) {
      throw new SandboxSpecError("workTree se solapa con writeDir o está dentro de readPaths");
    }
    writable.push(tree);
  }
  if (spec.pnpmLocks) {
    if (spec.credentials.length > 0) {
      throw new SandboxSpecError("pnpmLocks es de la instalación, que no lleva credenciales");
    }
    const uid = ctx.uid ?? process.getuid?.();
    if (uid === undefined) throw new SandboxSpecError("pnpmLocks: no se sabe el usuario");
    writable.push(pnpmLockDir(uid));
  }

  for (const d of spec.allowedDomains) {
    if (!validDomain(d)) {
      throw new SandboxSpecError(`dominio no admitido (solo nombres exactos): ${d}`);
    }
  }
  for (const name of spec.allowedEnv) {
    if (!ENV_NAME.test(name)) throw new SandboxSpecError(`variable de entorno no válida: ${name}`);
  }
  for (const c of spec.credentials) {
    if (!ENV_NAME.test(c.name)) throw new SandboxSpecError(`credencial no válida: ${c.name}`);
    if (c.injectDomains.length === 0) {
      throw new SandboxSpecError(`la credencial ${c.name} no tiene dominios de inyección`);
    }
    for (const d of c.injectDomains) {
      if (!spec.allowedDomains.includes(d)) {
        throw new SandboxSpecError(
          `la credencial ${c.name} inyecta en ${d}, que no está permitido`,
        );
      }
    }
  }

  const config: SandboxRuntimeConfig = {
    network: {
      allowedDomains: [...spec.allowedDomains],
      deniedDomains: [],
      strictAllowlist: true,
      allowUnixSockets: [],
      allowAllUnixSockets: false,
      allowLocalBinding: false,
    },
    filesystem: {
      denyRead: deniedRead(home, ctx.tmpDirs ?? userTmpDirs()),
      allowRead: [...new Set([...runtimePaths, ...readPaths, ...writable])],
      allowWrite: writable,
      denyWrite: [],
    },
  };
  if (spec.credentials.length > 0) {
    config.network.tlsTerminate = {};
    config.credentials = {
      envVars: spec.credentials.map((c) => ({
        name: c.name,
        mode: "mask" as const,
        injectHosts: [...c.injectDomains],
      })),
    };
  }
  return config;
}
