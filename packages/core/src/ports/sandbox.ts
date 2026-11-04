/** Una credencial a ocultar y los dominios donde se inyecta. Solo el nombre: el valor no viaja aquí. */
export interface SandboxCredential {
  name: string;
  injectDomains: readonly string[];
}

/** Especificación del ADR-008. Todo son datos: el sandbox no sabe qué agente ni qué proveedor hay. */
export interface SandboxSpec {
  /** Rutas absolutas en solo lectura: copia del repo, código del agente, entorno de ejecución. */
  readPaths: readonly string[];
  /** Único directorio escribible; también es el HOME y el directorio temporal del agente. */
  writeDir: string;
  /** Nombres exactos de dominio, nunca sufijos ni comodines. */
  allowedDomains: readonly string[];
  /** Variables de entorno que llegan al agente. */
  allowedEnv: readonly string[];
  credentials: readonly SandboxCredential[];
  timeoutMs: number;
}

export interface SandboxResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface Sandbox {
  run(spec: SandboxSpec, argv: readonly string[], input?: string): Promise<SandboxResult>;
}
