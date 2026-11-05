import type { CredentialMode, SecretStore } from "../keys/secret-store.ts";

/** Quedan las dos entradas (falló un borrado): no se elige ningún modo. */
export class InconsistentCredentialsError extends Error {
  constructor() {
    super("quedan las credenciales de los dos modos; vuelve a ejecutar el cambio de modo");
  }
}

export type CredentialStatus = CredentialMode | "inconsistent" | null;

/** Variable donde el trabajador entrega cada credencial (ADR-008, punto 6). */
const ENV_NAME: Record<CredentialMode, string> = {
  "api-key": "ANTHROPIC_API_KEY",
  subscription: "CLAUDE_CODE_OAUTH_TOKEN",
};
const MODES = Object.keys(ENV_NAME) as CredentialMode[];

/** Como mucho existe una entrada: el modo activo es la que haya. */
export function agentCredentials(store: SecretStore) {
  async function status(): Promise<CredentialStatus> {
    const present = (await Promise.all(MODES.map((m) => store.has(m)))).flatMap((has, i) =>
      has ? [MODES[i] as CredentialMode] : [],
    );
    if (present.length > 1) return "inconsistent";
    return present[0] ?? null;
  }

  return {
    status,
    /** Guarda la nueva y borra la del otro modo. Nada de lo que lanza contiene el secreto. */
    async set(mode: CredentialMode, secret: string): Promise<void> {
      await store.set(mode, secret);
      try {
        for (const other of MODES.filter((m) => m !== mode)) await store.delete(other);
      } catch {
        throw new InconsistentCredentialsError();
      }
    },
    /**
     * Solo para el trabajador (PR 13). Sin ruta HTTP: el daemon nunca devuelve el secreto, ni a su
     * propia CLI.
     */
    async read(): Promise<{ mode: CredentialMode; envName: string; secret: string } | null> {
      const mode = await status();
      if (mode === "inconsistent") throw new InconsistentCredentialsError();
      if (mode === null) return null;
      const secret = await store.get(mode);
      return secret === null ? null : { mode, envName: ENV_NAME[mode], secret };
    },
  };
}

export type AgentCredentials = ReturnType<typeof agentCredentials>;
