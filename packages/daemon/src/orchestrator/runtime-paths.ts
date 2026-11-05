import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ClaudeRuntime {
  /** Exactamente lo que el sandbox deja leer además de la copia del repo. Nada más. */
  paths: string[];
  /** Versión instalada del SDK: la que registra `session.started`. */
  sdkVersion: string;
}

/**
 * Las carpetas concretas que necesita el adaptador del Claude Agent SDK dentro del sandbox: la del
 * binario de Node, el paquete del trabajador, el del SDK (la ruta real lleva su versión) y su binario
 * nativo. Nunca la raíz del repo ni `node_modules`. `@togi/core` no está: el adaptador no lo importa.
 *
 * El paquete del trabajador entero, y no solo `src`: Node busca el `package.json` más cercano para
 * cargar un `.ts`, y si ese fichero queda fuera, sigue subiendo hasta una carpeta que el sandbox deniega.
 */
export function claudeRuntime(workerPackageDir: string): ClaudeRuntime {
  const worker = realpathSync(workerPackageDir);
  const sdk = realpathSync(join(worker, "node_modules", "@anthropic-ai", "claude-agent-sdk"));
  // Con pnpm, el binario nativo es un hermano del SDK dentro de la carpeta versionada.
  const native = realpathSync(
    join(dirname(sdk), `claude-agent-sdk-${process.platform}-${process.arch}`),
  );
  const { version } = JSON.parse(readFileSync(join(sdk, "package.json"), "utf8")) as {
    version: string;
  };
  return {
    paths: [dirname(realpathSync(process.execPath)), worker, sdk, native],
    sdkVersion: version,
  };
}
