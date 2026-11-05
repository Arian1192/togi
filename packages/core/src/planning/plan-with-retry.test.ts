import assert from "node:assert/strict";
import { test } from "node:test";
import { planWithRetry } from "./plan-with-retry.ts";
import type { PlannerPromptInput } from "./planner-prompt.ts";

const input: PlannerPromptInput = {
  instructions: "Eres el planificador.",
  task: { title: "t", description: null, acceptanceCriteria: null },
  repo: { name: "acme/web", baseBranch: "main" },
  nonce: "n0nc3",
};
const plan = {
  files: [{ path: "a.ts", change: "add" }],
  newTests: ["a.test.ts"],
  approach: "x",
  estimatedLines: { production: 10, tests: 10 },
};

/** Un agente que contesta lo que se le diga, en orden, y guarda los prompts que recibe. */
function agent(...answers: (string | Error)[]) {
  const prompts: string[] = [];
  const run = async (prompt: string) => {
    prompts.push(prompt);
    const answer = answers.shift();
    if (answer === undefined) throw new Error("llamada de más");
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { run, prompts };
}

test("una respuesta válida no se reintenta", async () => {
  const { run, prompts } = agent(JSON.stringify(plan));
  const result = await planWithRetry(input, run);
  assert.deepEqual(result, { ok: true, plan, attempts: 1 });
  assert.equal(prompts.length, 1);
});

test("una respuesta inválida se reintenta una vez con el error, y si la segunda vale, se acepta", async () => {
  const { run, prompts } = agent("no es json", JSON.stringify(plan));
  const result = await planWithRetry(input, run);
  assert.deepEqual(result, { ok: true, plan, attempts: 2 });
  assert.equal(prompts.length, 2);
  assert.ok(prompts[1]?.startsWith(prompts[0] ?? "x"));
  assert.match(prompts[1] ?? "", /<<<ERROR_DE_VALIDACION n0nc3>>>\n.*JSON.*\n<<<FIN n0nc3>>>/);
});

test("si el reintento también falla, acaba con invalid_plan y no pide una tercera vez", async () => {
  const { run, prompts } = agent("no es json", JSON.stringify({ ...plan, approach: "" }));
  const result = await planWithRetry(input, run);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.code === "invalid_plan" && /approach/.test(result.error));
  assert.equal(prompts.length, 2);
});

test("un fallo del agente no es un plan inválido: se propaga sin reintentar", async () => {
  const { run, prompts } = agent(new Error("agente caído"));
  await assert.rejects(() => planWithRetry(input, run), /agente caído/);
  assert.equal(prompts.length, 1);
});

test("los dos intentos comparten el mismo delimitador", async () => {
  const { nonce: _nonce, ...sinNonce } = input;
  const { run, prompts } = agent("no es json", JSON.stringify(plan));
  await planWithRetry(sinNonce, run);
  const code = (p?: string) => /<<<TAREA_OBJETIVO ([0-9a-f]{32})>>>/.exec(p ?? "")?.[1];
  assert.ok(code(prompts[0]));
  assert.match(prompts[1] ?? "", new RegExp(`<<<ERROR_DE_VALIDACION ${code(prompts[0])}>>>`));
});
