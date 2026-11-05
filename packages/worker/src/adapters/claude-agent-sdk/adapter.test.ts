import assert from "node:assert/strict";
import { test } from "node:test";
import { FAILURE_REASONS } from "@togi/core";
import { claudeAgentSdkDeclaration } from "./declaration.ts";
import { PLANNER_TOOLS, plannerHook } from "./planner-policy.ts";
import { type PlannerRun, type QueryFn, runPlanner } from "./run.ts";

const RUN: PlannerRun = { prompt: "p", cwd: "/w/repo", model: "m", maxTurns: 5, maxBudgetUsd: 0.5 };

const result = (subtype: string) => ({
  type: "result",
  subtype,
  num_turns: 3,
  total_cost_usd: 0.12,
  usage: { input_tokens: 100, output_tokens: 20 },
});

/** SDK simulado: guarda las opciones recibidas y devuelve los mensajes dados. */
function fake(messages: unknown[]) {
  const seen: { options?: Record<string, unknown> } = {};
  const query: QueryFn = ({ options }) => {
    seen.options = options;
    return (async function* () {
      yield* messages;
    })();
  };
  return { seen, query };
}

const collect = async (gen: AsyncGenerator<unknown>) => {
  const out: { kind: string; payload: Record<string, unknown> }[] = [];
  for await (const line of gen) out.push(line as (typeof out)[number]);
  return out;
};

test("modo clave de API: credencial con marcador y sus dominios, rutas y sin sandbox propio", () => {
  const d = claudeAgentSdkDeclaration("api-key");
  assert.deepEqual(d.domains, ["api.anthropic.com"]);
  assert.deepEqual(d.credentials, [
    { name: "ANTHROPIC_API_KEY", injectDomains: ["api.anthropic.com"] },
  ]);
  assert.deepEqual(d.clearEnv, []);
  assert.deepEqual(d.writablePaths, ["writeDir"]);
  assert.equal(d.ownSandbox, false);
});

test("modo suscripción: el token va en claro, sin marcador ni inyección", () => {
  const d = claudeAgentSdkDeclaration("subscription");
  assert.deepEqual(d.domains, ["api.anthropic.com"]);
  assert.deepEqual(d.credentials, []);
  assert.deepEqual(d.clearEnv, ["CLAUDE_CODE_OAUTH_TOKEN"]);
  assert.equal(d.ownSandbox, false);
});

test("lanza el SDK sin ajustes del repo, solo lectura, con topes y sin telemetría", async () => {
  const { seen, query } = fake([result("success")]);
  await collect(runPlanner(RUN, query));
  const o = seen.options ?? {};
  assert.deepEqual(o.settingSources, []);
  assert.equal(o.permissionMode, "dontAsk");
  assert.deepEqual(o.allowedTools, ["Read", "Glob", "Grep"]);
  assert.equal(o.maxTurns, 5);
  assert.equal(o.maxBudgetUsd, 0.5);
  assert.equal((o.env as Record<string, string>).CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
});

test("el hook deniega y registra cualquier herramienta fuera de la lista", async () => {
  const lines: unknown[] = [];
  const hook = plannerHook((l) => lines.push(l));
  for (const tool of PLANNER_TOOLS) {
    assert.deepEqual(await hook({ hook_event_name: "PreToolUse", tool_name: tool }), {});
  }
  for (const tool of ["Bash", "Write", "Edit", "WebFetch"]) {
    const out = await hook({ hook_event_name: "PreToolUse", tool_name: tool });
    assert.equal(out.hookSpecificOutput?.permissionDecision, "deny");
  }
  assert.equal(lines.length, 4);
  assert.deepEqual(lines[0], { kind: "denied", payload: { tool: "Bash" } });
});

test("normaliza la trayectoria y cierra con el uso real", async () => {
  const { query } = fake([
    { type: "assistant", message: { content: [{ type: "text", text: "hola" }] } },
    {
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "a" } }] },
    },
    { type: "user", message: { content: [{ type: "tool_result", is_error: false }] } },
    result("success"),
  ]);
  const lines = await collect(runPlanner(RUN, query));
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["message", "tool_call", "tool_result", "usage"],
  );
  assert.deepEqual(lines[3]?.payload, {
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0.12,
    turns: 3,
    stop: "ok",
  });
});

test("si se agotan los turnos o el coste, el uso dice por qué paró", async () => {
  for (const [subtype, stop] of [
    ["error_max_turns", "max_turns"],
    ["error_max_budget_usd", "max_budget"],
    ["error_during_execution", "error"],
  ] as const) {
    const lines = await collect(runPlanner(RUN, fake([result(subtype)]).query));
    assert.equal(lines.at(-1)?.payload.stop, stop);
  }
});

test("los códigos de los topes están en la lista cerrada de fallos", () => {
  assert.ok(FAILURE_REASONS.includes("max_turns_exceeded"));
  assert.ok(FAILURE_REASONS.includes("budget_exceeded"));
});
