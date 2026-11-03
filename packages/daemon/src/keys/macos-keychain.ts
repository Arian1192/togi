import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { APP } from "../config/app.ts";
import { fromHex, type Keychain, toHex } from "./keychain.ts";

/** Ejecuta `file` sin shell, con `stdin` opcional. Rechaza con `{ code }` si sale con error. */
export type Exec = (file: string, args: string[], stdin?: string) => Promise<string>;

const NOT_FOUND = 44;

export const execFileNoShell: Exec = (file, args, stdin) =>
  new Promise((resolvePromise, reject) => {
    const child = execFile(file, args, { encoding: "utf8" }, (error, stdout) =>
      error ? reject(error) : resolvePromise(stdout),
    );
    child.stdin?.end(stdin);
  });

/** Cuenta propia de cada instalación: dos directorios de datos distintos no comparten clave maestra. */
export const keychainAccount = (home: string): string =>
  `${APP.name}-${createHash("sha256").update(resolve(home)).digest("hex").slice(0, 12)}`;

const SERVICE = `${APP.name}-master-key`;

const ACCOUNT_PATTERN = new RegExp(`^${APP.name}-[0-9a-f]{12}$`);
const UNSAFE_PATH = /[\s"'\\]/;

/**
 * Construye la línea de `security -i`. Valida cada valor antes de interpolarlo: si alguno no
 * cumple, lanza sin haber ejecutado nada.
 */
function addCommand(account: string, service: string, hex: string, keychainPath?: string): string {
  if (!ACCOUNT_PATTERN.test(account)) throw new Error("cuenta de llavero no válida");
  if (service !== `${APP.name}-master-key`) throw new Error("servicio de llavero no válido");
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("clave no válida");
  if (keychainPath !== undefined && UNSAFE_PATH.test(keychainPath)) {
    throw new Error("ruta de llavero no admitida: sin espacios, comillas ni saltos de línea");
  }
  const target = keychainPath === undefined ? "" : ` ${keychainPath}`;
  return `add-generic-password -a ${account} -s ${service} -w ${hex}${target}\n`;
}

/**
 * Llavero de macOS vía `security`. El secreto nunca va en los argumentos (visibles con `ps`): se
 * escribe por stdin con `security -i`. La lectura (`-w`) lo recibe por stdout.
 */
export class MacosKeychain implements Keychain {
  readonly #account: string;
  readonly #exec: Exec;
  readonly #keychainPath: string | undefined;

  /** `keychainPath` es para el test de integración con un llavero temporal. */
  constructor(home: string, exec: Exec = execFileNoShell, keychainPath?: string) {
    this.#account = keychainAccount(home);
    this.#exec = exec;
    this.#keychainPath = keychainPath;
  }

  async get(): Promise<Uint8Array | null> {
    const extra = this.#keychainPath === undefined ? [] : [this.#keychainPath];
    try {
      const stdout = await this.#exec(
        "security",
        ["find-generic-password", "-a", this.#account, "-s", SERVICE, "-w", ...extra],
        undefined,
      );
      return fromHex(stdout);
    } catch (error) {
      // Solo el código 44 significa «no existe»; cualquier otro fallo es un error real.
      if ((error as { code?: unknown }).code === NOT_FOUND) return null;
      throw error;
    }
  }

  async create(key: Uint8Array): Promise<void> {
    // Sin -U: si ya existe, `security` sale con error y no se sobrescribe.
    const line = addCommand(this.#account, SERVICE, toHex(key), this.#keychainPath);
    await this.#exec("security", ["-i"], line);
  }
}
