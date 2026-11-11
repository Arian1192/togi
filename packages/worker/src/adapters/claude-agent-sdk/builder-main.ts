import { parseBuilderRun, runBuilder } from "./builder-run.ts";
import type { QueryFn } from "./run.ts";

/**
 * Punto de entrada del builder dentro del sandbox, como `main.ts`. La entrada se valida antes de
 * arrancar el SDK: si no es válida, sale con 1 sin cargarlo.
 */
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
let parsed: unknown = null;
try {
  parsed = JSON.parse(raw);
} catch {}
const run = parseBuilderRun(parsed);
if (run === null) {
  process.stderr.write("entrada del builder no válida\n");
  process.exit(1);
}
let ok = false;
try {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  for await (const line of runBuilder(run, query as QueryFn)) {
    process.stdout.write(`${JSON.stringify(line)}\n`);
    if (line.kind === "usage") ok = (line.payload as { stop: string }).stop === "ok";
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error del SDK: ${message.slice(0, 2000)}\n`);
}
process.exit(ok ? 0 : 1);
