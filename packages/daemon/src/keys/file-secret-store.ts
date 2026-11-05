import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CredentialMode, SERVICES, type SecretStore } from "./secret-store.ts";

/** Solo para tests (TOGI_KEYCHAIN=file): el secreto queda en claro en disco. */
export class FileSecretStore implements SecretStore {
  readonly #dir: string;

  constructor(home: string) {
    this.#dir = home;
  }

  #path = (mode: CredentialMode): string => join(this.#dir, `${SERVICES[mode]}.secret`);

  async has(mode: CredentialMode): Promise<boolean> {
    return (await this.get(mode)) !== null;
  }

  async get(mode: CredentialMode): Promise<string | null> {
    try {
      return await readFile(this.#path(mode), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async set(mode: CredentialMode, secret: string): Promise<void> {
    await mkdir(this.#dir, { recursive: true, mode: 0o700 });
    await writeFile(this.#path(mode), secret, { mode: 0o600 });
  }

  async delete(mode: CredentialMode): Promise<void> {
    await rm(this.#path(mode), { force: true });
  }
}
