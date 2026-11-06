// Un agente de mentira que corre dentro del sandbox real, con la misma interfaz que el del SDK: la
// petición llega por la entrada estándar y los eventos salen por la salida, uno por línea. Lo que
// hace lo decide `MODE:<modo>` en el prompt (el título de la tarea).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const run = JSON.parse(raw);

const out = (kind, payload) => process.stdout.write(`${JSON.stringify({ kind, payload })}\n`);
const usage = (stop, costUsd) =>
  out("usage", { inputTokens: 10, outputTokens: 5, costUsd, turns: 1, stop });

const mode = /MODE:([a-z-]+)/.exec(run.prompt)?.[1] ?? "ok";
const retrying = run.prompt.includes("ERROR_DE_VALIDACION");

// Node termina si un await de nivel superior nunca puede resolverse: el temporizador lo mantiene vivo.
if (mode === "hang") await new Promise(() => setInterval(() => {}, 1000));
if (mode === "budget") {
  usage("max_budget", 0.9);
  process.exit(1);
}

if (mode === "stderr") {
  // Un fallo que escribe en stderr, con algo que parece una clave: no debe llegar a daemon.log.
  const key = ["sk", "ant", "api03", "A".repeat(40)].join("-");
  process.stderr.write(`Error: la API rechazó la petición con ${key}\nsegunda línea de contexto\n`);
  process.exit(1);
}

if (mode === "escape") {
  // El agente controla su stderr: escapes de terminal (C0 y C1), un retorno de carro y una línea que
  // imita una del orquestador.
  process.stderr.write(
    "\u001b]0;titulo\u0007\u001b[31mroja\u001b[0m\u009b2J\rtexto\norquestador: FALSO plan aprobado\n",
  );
  process.exit(1);
}

// Lo que ve: el README de la copia, un marcador en vez de la credencial, y el prompt que recibió.
const readme = readFileSync(`${run.cwd}/README.md`, "utf8").trim();
const bad = mode === "always-bad" || (mode === "bad-then-good" && !retrying);
const plan = {
  files: [{ path: "README.md", change: "modify" }],
  newTests: ["README.test.ts"],
  approach: [
    `readme=${readme}`,
    `key=${process.env.ANTHROPIC_API_KEY ?? ""}`,
    `prompt=${createHash("sha256").update(run.prompt).digest("hex")}`,
    `budget=${run.maxBudgetUsd}`,
  ].join("\n"),
  estimatedLines: { production: 5, tests: 10 },
};
out("tool_call", { tool: "Read" });
out("message", { text: bad ? "no es JSON" : `\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`` });
usage("ok", 0.1);
