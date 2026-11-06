import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SandboxSpec } from "@togi/core";

/** Escenario de una ejecución de la batería: todo vive en un directorio temporal. */
export interface Scene {
  root: string;
  home: string;
  togiHome: string;
  repo: string;
  scratch: string;
  outside: string;
  /** Carpeta del binario de Node que usa el agente, dentro de la carpeta personal (como con nvm). */
  nodeBin: string;
  fakeKey: string;
  socket?: string;
  port?: number;
  keychain?: string | undefined;
  /** Señuelos de lectura fuera de la carpeta personal (fichero con contenido falso), si se pudieron crear. */
  decoys?: { system: string; userTmp: string; shared?: string };
}

export interface Probe {
  id: string;
  title: string;
  /** Qué debe pasar dentro del sandbox: el acceso falla (DENIED) o funciona (ALLOWED). */
  expect: "DENIED" | "ALLOWED";
  /** Imprime solo ALLOWED o DENIED, nunca contenido. */
  argv: (s: Scene) => string[];
  spec?: (s: Scene) => Partial<SandboxSpec>;
  /** Convierte lo ocurrido en ALLOWED o DENIED cuando la salida del comando no basta. */
  outcome?: (s: Scene, stdout: string) => Promise<string>;
  /** Con un control positivo que falla (sin red, por ejemplo), la sonda se omite en vez de pasar. */
  controlFailure?: string;
  /** Una permitida sin control propio no lo necesita; las bloqueadas siempre lo llevan. */
  control?: boolean;
  /** Fallo conocido: la sonda se ejecuta como `todo` de node:test, con su causa. */
  todo?: string;
  /** Tope de tiempo de toda la sonda (control, sandbox y resultado); por defecto PROBE_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** Cubre el control (20 s) y la ejecución en el sandbox (20 s) con margen. */
export const PROBE_TIMEOUT_MS = 60_000;

const sh = (script: string, ...args: string[]) => ["/bin/sh", "-c", script, "sh", ...args];
const yes = `&& echo ALLOWED || echo DENIED`;
const reads = (path: string) => sh(`head -c1 "$1" >/dev/null 2>&1 ${yes}`, path);
const writes = (path: string) => sh(`: > "$1" 2>/dev/null ${yes}`, path);
const http = (url: string) =>
  sh(`c=$(/usr/bin/curl -s -m10 -o /dev/null -w '%{http_code}' "$1"); [ "$c" != 000 ] ${yes}`, url);
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const ENV_NAME = "TOGI_CONFORMANCE_ENV";
export const KEY_NAME = "TOGI_CONFORMANCE_KEY";
const API = "api.anthropic.com";
const NET = "sin conexión a Internet: el control positivo falla";

/**
 * Lee el entorno inicial (KERN_PROCARGS2) de todos los PID posibles y busca la credencial. Desde el
 * sandbox solo son legibles el propio proceso y sus antecesores (el trabajador entre ellos); no se
 * fía del listado de procesos, que el sandbox recorta. Cada consulta tiene un tope de 0,5 s y un
 * proceso que no responde se ignora, salvo un antecesor: si no se pudo consultar alguno (o la
 * cadena de padres, o se agotó el tope global de 15 s) imprime ERROR y no prueba nada; el suite lo
 * trata como fallo. La aguja llega en dos mitades en el argv, así que el propio proceso no la
 * contiene entera.
 */
const SCAN_ENVIRONMENTS = [
  "import ctypes, os, signal, sys, time",
  "libc = ctypes.CDLL('/usr/lib/libc.dylib')",
  "needle = (sys.argv[1] + sys.argv[2]).encode()",
  "class Slow(Exception): pass",
  "def on_alarm(*_): raise Slow()",
  "signal.signal(signal.SIGALRM, on_alarm)",
  "def query(*ids):",
  "    mib = (ctypes.c_int * len(ids))(*ids)",
  "    try:",
  "        signal.setitimer(signal.ITIMER_REAL, 0.5)",
  "        size = ctypes.c_size_t(0)",
  "        if libc.sysctl(mib, len(ids), None, ctypes.byref(size), None, 0) != 0: return None",
  "        buf = ctypes.create_string_buffer(size.value)",
  "        if libc.sysctl(mib, len(ids), buf, ctypes.byref(size), None, 0) != 0: return None",
  "        return buf.raw[:size.value]",
  "    except Slow: return None",
  "    finally: signal.setitimer(signal.ITIMER_REAL, 0)",
  "def args_of(pid): return query(1, 49, pid)",
  "def parent_of(pid):",
  "    info = query(1, 14, 1, pid)",
  "    return int.from_bytes(info[560:564], 'little') if info and len(info) >= 564 else None",
  "def fail(why): print('ERROR ' + why); sys.exit(0)",
  "deadline = time.monotonic() + 15",
  "me = os.getpid()",
  "if parent_of(me) != os.getppid(): fail('no se pudo leer la cadena de padres')",
  "chain, pid = [], me",
  "while pid > 1:",
  "    chain.append(pid)",
  "    pid = parent_of(pid)",
  "    if pid is None: fail('no se pudo leer la cadena de padres')",
  "found = False",
  "for pid in chain:",
  "    data = args_of(pid)",
  "    if data is None: fail('antecesor %d sin consultar' % pid)",
  "    found = found or needle in data",
  "for pid in range(2, 100000):",
  "    if found: break",
  "    if time.monotonic() > deadline: fail('tope global agotado')",
  "    found = needle in (args_of(pid) or b'')",
  "print('ALLOWED' if found else 'DENIED')",
].join("\n");

/** El argv de un agente que busca `needle` en el entorno inicial de los procesos que puede leer. */
export const scanArgv = (needle: string): string[] => {
  const half = Math.floor(needle.length / 2);
  return ["/usr/bin/python3", "-c", SCAN_ENVIRONMENTS, needle.slice(0, half), needle.slice(half)];
};
const scanFor = (s: Scene) => scanArgv(`${KEY_NAME}=${s.fakeKey}`);

const OUTSIDE_HOME_TODO =
  "hueco confirmado: el sandbox solo deniega la carpeta personal (denyRead: [home]) y todo lo de fuera se lee; lo cierra el PR siguiente";

export const probes: readonly Probe[] = [
  {
    id: "credencial-entorno-ajeno",
    title: "leer la credencial real del entorno de otros procesos (antecesores y trabajador)",
    expect: "DENIED",
    argv: scanFor,
    spec: () => masked,
  },
  {
    id: "secretos",
    title: "leer secretos falsos de la carpeta personal",
    expect: "DENIED",
    argv: (s) => reads(join(s.home, "togi-conformance-secrets", "key")),
  },
  {
    id: "ssh",
    title: "leer ~/.ssh",
    expect: "DENIED",
    argv: (s) => reads(join(s.home, ".ssh", "id_conformance")),
  },
  {
    id: "aws",
    title: "leer ~/.aws",
    expect: "DENIED",
    argv: (s) => reads(join(s.home, ".aws", "credentials")),
  },
  {
    id: "togi-token",
    title: "leer el token de ~/.togi",
    expect: "DENIED",
    argv: (s) => reads(join(s.togiHome, "token")),
  },
  {
    id: "llavero",
    title: "leer una entrada falsa del Llavero",
    expect: "DENIED",
    argv: (s) =>
      sh(
        `/usr/bin/security find-generic-password -s togi-conformance -w "$1" >/dev/null 2>&1 ${yes}`,
        s.keychain ?? "",
      ),
  },
  {
    id: "socket-unix",
    title: "conectar a un socket Unix falso",
    expect: "DENIED",
    argv: (s) => sh(`/usr/bin/nc -U -w1 "$1" </dev/null >/dev/null 2>&1 ${yes}`, s.socket ?? ""),
  },
  {
    id: "puerto-local",
    title: "conectar a un puerto local falso",
    expect: "DENIED",
    argv: (s) => sh(`/usr/bin/nc -z -w2 127.0.0.1 "$1" >/dev/null 2>&1 ${yes}`, String(s.port)),
  },
  {
    id: "red-permitida",
    title: "alcanzar api.anthropic.com sin credenciales",
    expect: "ALLOWED",
    control: true,
    controlFailure: NET,
    argv: () => http(`https://${API}/v1/messages`),
    spec: () => ({ allowedDomains: [API] }),
  },
  {
    id: "red-bloqueada",
    title: "alcanzar un dominio no permitido",
    expect: "DENIED",
    controlFailure: NET,
    argv: () => http("https://example.com"),
    spec: () => ({ allowedDomains: [API] }),
  },
  {
    id: "dns",
    title: "resolver un nombre de un dominio no permitido",
    expect: "DENIED",
    controlFailure: NET,
    argv: () => sh(`/usr/bin/dscacheutil -q host -a name example.org | grep -q ip_address ${yes}`),
    spec: () => ({ allowedDomains: [API] }),
  },
  {
    id: "tmp-sistema",
    title: "leer un fichero de /tmp",
    expect: "DENIED",
    argv: (s) => reads(s.decoys?.system ?? ""),
    todo: OUTSIDE_HOME_TODO,
  },
  {
    id: "tmp-usuario",
    title: "leer un fichero de la carpeta temporal del usuario (os.tmpdir())",
    expect: "DENIED",
    argv: (s) => reads(s.decoys?.userTmp ?? ""),
    todo: OUTSIDE_HOME_TODO,
  },
  {
    id: "compartido",
    title: "leer un fichero de /Users/Shared",
    expect: "DENIED",
    controlFailure: "no se pudo crear el señuelo en /Users/Shared",
    argv: (s) => reads(s.decoys?.shared ?? "/nonexistent"),
    todo: OUTSIDE_HOME_TODO,
  },
  {
    id: "lectura-permitida",
    title: "leer un fichero de la copia del repo",
    expect: "ALLOWED",
    argv: (s) => reads(join(s.repo, "dato")),
  },
  {
    id: "escritura-permitida",
    title: "escribir en el directorio desechable",
    expect: "ALLOWED",
    argv: (s) => writes(join(s.scratch, "ok")),
  },
  {
    id: "escritura-fuera",
    title: "escribir fuera del directorio desechable",
    expect: "DENIED",
    argv: (s) => writes(join(s.outside, "no")),
  },
  {
    id: "entorno",
    title: "ver una variable del usuario que no está permitida",
    expect: "DENIED",
    argv: () => sh(`[ -n "\${${ENV_NAME}+x}" ] ${yes}`),
  },
  {
    id: "credencial-valor",
    title: "ver el valor real de la credencial enmascarada",
    expect: "DENIED",
    argv: (s) => sh(`[ "$${KEY_NAME}" = "${s.fakeKey}" ] ${yes}`),
    spec: () => masked,
  },
  {
    id: "credencial-marcador",
    title: "recibir un marcador en lugar del valor real",
    expect: "ALLOWED",
    argv: (s) => sh(`[ -n "$${KEY_NAME}" ] && [ "$${KEY_NAME}" != "${s.fakeKey}" ] ${yes}`),
    spec: () => masked,
  },
  {
    id: "node-propio",
    title: "ejecutar el binario de Node permitido en la carpeta personal",
    expect: "ALLOWED",
    argv: (s) => [join(s.nodeBin, "node")],
  },
  {
    id: "node-hermano",
    title: "leer otra versión de Node de la misma carpeta",
    expect: "DENIED",
    argv: (s) => reads(join(s.nodeBin, "..", "..", "v22", "bin", "node")),
  },
  {
    id: "node-resto",
    title: "leer el resto de la carpeta de Node",
    expect: "DENIED",
    argv: (s) => reads(join(s.nodeBin, "..", "..", "..", "..", "nvm.sh")),
  },
  {
    id: "escapar-del-tope",
    title: "un proceso con setsid no sobrevive a la ejecución",
    expect: "DENIED",
    argv: (s) =>
      sh(
        `/usr/bin/perl -MPOSIX -e 'exit 0 if fork; POSIX::setsid(); open F, ">", $ARGV[0]; print F $$; close F; exec "sleep", "60"' "$1" </dev/null >/dev/null 2>&1; for i in 1 2 3 4 5 6 7 8 9 10; do [ -s "$1" ] && break; sleep 0.1; done`,
        join(s.scratch, "escape.pid"),
      ),
    outcome: async (s) => {
      const pid = Number(readFileSync(join(s.scratch, "escape.pid"), "utf8"));
      await new Promise((r) => setTimeout(r, 200));
      const survives = pid > 1 && alive(pid);
      if (survives) process.kill(pid, "SIGKILL");
      return survives ? "ALLOWED" : "DENIED";
    },
  },
];

const masked: Partial<SandboxSpec> = {
  allowedDomains: [API],
  allowedEnv: ["PATH", KEY_NAME],
  credentials: [{ name: KEY_NAME, injectDomains: [API] }],
};

/** Ejecuta la sonda sin sandbox: si no devuelve ALLOWED, la sonda no prueba nada. */
export function control(argv: readonly string[]): Promise<string> {
  const [cmd, ...args] = argv;
  return new Promise((resolve) => {
    execFile(cmd as string, args, { timeout: 20000, env: process.env }, (_e, stdout) =>
      resolve(stdout.trim() || "ERROR"),
    );
  });
}
