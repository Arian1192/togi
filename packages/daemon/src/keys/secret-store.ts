/** Modo de credencial del agente (ADR-008, punto 6). Cada modo es una entrada distinta. */
export type CredentialMode = "api-key" | "subscription";

/** Guarda las credenciales del agente. Entradas propias, distintas de la clave maestra. */
export interface SecretStore {
  /** Existencia sin leer el secreto. */
  has(mode: CredentialMode): Promise<boolean>;
  get(mode: CredentialMode): Promise<string | null>;
  /** Crea o sustituye. */
  set(mode: CredentialMode, secret: string): Promise<void>;
  /** No falla si no existe. */
  delete(mode: CredentialMode): Promise<void>;
}

export const SERVICES: Record<CredentialMode, string> = {
  "api-key": "togi-agent-api-key",
  subscription: "togi-agent-subscription-token",
};
