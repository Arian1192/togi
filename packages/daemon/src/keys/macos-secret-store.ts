import { type Exec, execFileNoShell, keychainAccount } from "./macos-keychain.ts";
import { type CredentialMode, SERVICES, type SecretStore } from "./secret-store.ts";

const NOT_FOUND = 44;
const SAFE_SECRET = /^[\x21-\x7e]+$/;

const absent = (error: unknown): boolean => (error as { code?: unknown }).code === NOT_FOUND;

/**
 * Llavero de macOS para las credenciales del agente. Igual que la clave maestra: el secreto se
 * escribe por stdin con `security -i`, nunca en los argumentos.
 */
export class MacosSecretStore implements SecretStore {
  readonly #account: string;
  readonly #exec: Exec;

  constructor(home: string, exec: Exec = execFileNoShell) {
    this.#account = keychainAccount(home);
    this.#exec = exec;
  }

  #find(mode: CredentialMode, extra: string[]): Promise<string> {
    const args = ["find-generic-password", "-a", this.#account, "-s", SERVICES[mode], ...extra];
    return this.#exec("security", args, undefined);
  }

  async has(mode: CredentialMode): Promise<boolean> {
    try {
      await this.#find(mode, []); // sin -w: no lee el secreto
      return true;
    } catch (error) {
      if (absent(error)) return false;
      throw error;
    }
  }

  async get(mode: CredentialMode): Promise<string | null> {
    try {
      return (await this.#find(mode, ["-w"])).replace(/\n$/, "");
    } catch (error) {
      if (absent(error)) return null;
      throw error;
    }
  }

  async set(mode: CredentialMode, secret: string): Promise<void> {
    if (!SAFE_SECRET.test(secret) || /["'\\]/.test(secret)) throw new Error("credencial no válida");
    // -U: aquí sí sustituye la entrada anterior.
    const line = `add-generic-password -U -a ${this.#account} -s ${SERVICES[mode]} -w ${secret}\n`;
    await this.#exec("security", ["-i"], line);
  }

  async delete(mode: CredentialMode): Promise<void> {
    try {
      await this.#exec(
        "security",
        ["delete-generic-password", "-a", this.#account, "-s", SERVICES[mode]],
        undefined,
      );
    } catch (error) {
      if (!absent(error)) throw error;
    }
  }
}
