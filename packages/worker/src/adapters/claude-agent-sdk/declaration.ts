import type { AGENT_CREDENTIAL_MODES } from "@togi/core";

export type CredentialMode = (typeof AGENT_CREDENTIAL_MODES)[number];

/** Lo que un adaptador de runtime necesita del sandbox (ADR-008 §7). Togi lo traduce a `SandboxSpec`. */
export interface RuntimeDeclaration {
  /** Nombres exactos de dominio. */
  domains: readonly string[];
  /** Credenciales que el sandbox oculta tras un marcador y solo inyecta en estos dominios. */
  credentials: readonly { name: string; injectDomains: readonly string[] }[];
  /** Credenciales que el agente ve en claro, sin marcador: el cliente oficial las necesita (ADR-008 §6). */
  clearEnv: readonly string[];
  /** Rutas donde escribe: solo el directorio del agente, que es también su HOME. */
  writablePaths: readonly "writeDir"[];
  /** `false`: el adaptador no trae sandbox propio, así que lo confina el de togi. */
  ownSandbox: boolean;
}

const API = "api.anthropic.com";

/**
 * Clave de API: el agente solo ve un marcador y el sandbox la inyecta en `api.anthropic.com`.
 * Suscripción: el token llega en claro (protección: solo la red limitada).
 */
export function claudeAgentSdkDeclaration(mode: CredentialMode): RuntimeDeclaration {
  const api = mode === "api-key";
  return {
    domains: [API],
    credentials: api ? [{ name: "ANTHROPIC_API_KEY", injectDomains: [API] }] : [],
    clearEnv: api ? [] : ["CLAUDE_CODE_OAUTH_TOKEN"],
    writablePaths: ["writeDir"],
    ownSandbox: false,
  };
}
