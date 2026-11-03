import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { APP } from "../config/app.ts";
import { fromHex, type Keychain, toHex } from "./keychain.ts";

/** Solo para tests: la clave queda en claro en disco. Se activa con TOGI_KEYCHAIN=file. */
export class FileKeychain implements Keychain {
  readonly #path: string;
  readonly #dir: string;

  constructor(home: string) {
    this.#dir = home;
    this.#path = join(home, `${APP.name}-master.key`);
  }

  async get(): Promise<Uint8Array | null> {
    try {
      return fromHex(await readFile(this.#path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async create(key: Uint8Array): Promise<void> {
    await mkdir(this.#dir, { recursive: true, mode: 0o700 });
    await writeFile(this.#path, toHex(key), { flag: "wx", mode: 0o600 });
  }
}
