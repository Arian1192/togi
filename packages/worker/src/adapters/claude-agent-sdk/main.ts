import { DEFAULT_LIMITS, type PlannerRun, runPlanner } from "./run.ts";

/**
 * Punto de entrada que el trabajador lanza dentro del sandbox: la petición llega por la entrada
 * estándar y los eventos salen por la salida, uno por línea. Sale con 1 si no terminó con éxito.
 */
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const run: PlannerRun = { ...DEFAULT_LIMITS, model: "claude-sonnet-5-5", ...JSON.parse(raw) };
let ok = false;
for await (const line of runPlanner(run)) {
  process.stdout.write(`${JSON.stringify(line)}\n`);
  if (line.kind === "usage") ok = (line.payload as { stop: string }).stop === "ok";
}
process.exit(ok ? 0 : 1);
