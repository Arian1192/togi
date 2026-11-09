// Agente falso del extremo a extremo de la rebanada 2: corre dentro del sandbox real, con la interfaz
// de fake-agent.mjs (petición por stdin, eventos JSON por stdout). Lo que hace lo decide el prompt:
// - `PIDE-V2` (lo trae el motivo de «pedir cambios»): propone la versión 2 del plan;
// - `MODE:over-limit` (en el título): un plan por encima de los límites;
// - `MODE:hang-once` (en el título): se queda colgado mientras exista el fichero que indica
//   `HANG:<ruta>`, para que el test mate al trabajador una vez y togi lo reintente solo.
import { existsSync, readFileSync } from "node:fs";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const run = JSON.parse(raw);
const out = (kind, payload) => process.stdout.write(`${JSON.stringify({ kind, payload })}\n`);

const hang = /HANG:(\S+)/.exec(run.prompt)?.[1];
if (run.prompt.includes("MODE:hang-once") && hang && existsSync(hang)) {
  await new Promise(() => setInterval(() => {}, 1000));
}

const readme = readFileSync(`${run.cwd}/README.md`, "utf8").trim();
const v2 = run.prompt.includes("PIDE-V2");
const over = run.prompt.includes("MODE:over-limit");
const plan = {
  files: [{ path: "README.md", change: "modify" }],
  newTests: ["README.test.ts"],
  approach: `${v2 ? "versión 2: lo que pidió el humano" : "versión 1"} · readme=${readme}`,
  estimatedLines: over ? { production: 450, tests: 200 } : { production: 5, tests: 10 },
};
out("tool_call", { tool: "Read" });
out("message", { text: `\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`` });
out("usage", { inputTokens: 10, outputTokens: 5, costUsd: 0.1, turns: 1, stop: "ok" });
