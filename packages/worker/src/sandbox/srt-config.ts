import { realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
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
  if (spec.readPaths.length === 0) throw new SandboxSpecError("readPaths está vacío");

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
      denyRead: [home],
      allowRead: [...new Set([...runtimePaths, ...readPaths, writeDir])],
      allowWrite: [writeDir],
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
