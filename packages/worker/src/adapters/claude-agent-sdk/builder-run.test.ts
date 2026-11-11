import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILDER_TOOLS } from "./builder-policy.ts";
import { type BuilderRun, runBuilder } from "./builder-run.ts";
import type { QueryFn } from "./run.ts";

const RUN: BuilderRun = {
  prompt: "p",
  cwd: "/w/tree",
  model: "m",
  effort: "medium",
  maxTurns: 30,
  maxBudgetUsd: 2,
  policy: {
    checks: { typecheck: "pnpm typecheck", lint: null, test: "pnpm test" },
    planFiles: ["src/a.ts"],
    existingTests: ["src/a.test.ts"],
    protectedPaths: ["package.json"],
  },
};

type Call = { tool_name: string; tool_input: unknown };

/** SDK simulado: llama al hook real con cada herramienta y termina con un `result`. */
function fake(calls: Call[]) {
  const seen: { options?: Record<string, unknown>; outputs: unknown[] } = { outputs: [] };
  const query: QueryFn = ({ options }) => {
    seen.options = options;
    return (async function* () {
      const hook = options.hooks.PreToolUse[0].hooks[0];
      for (const call of calls) {
        seen.outputs.push(await hook({ hook_event_name: "PreToolUse", ...call }));
        yield { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } };
      }
      yield { type: "result", subtype: "success", num_turns: 1, total_cost_usd: 0.1 };
    })();
  };
  return { seen, query };
}

const collect = async (gen: AsyncGenerator<unknown>) => {
  const out: { kind: string; payload: Record<string, unknown> }[] = [];
  for await (const line of gen) out.push(line as (typeof out)[number]);
  return out;
};

const denies = (out: unknown) => JSON.stringify(out).includes('"permissionDecision":"deny"');

test("el SDK recibe cwd, modelo, esfuerzo, herramientas, topes y nada de la configuración del repo", async () => {
  const { seen, query } = fake([]);
  await collect(runBuilder({ ...RUN, executable: "/bin/claude" }, query));
  const o = seen.options ?? {};
  assert.equal(o.cwd, "/w/tree");
  assert.equal(o.model, "m");
  assert.equal(o.effort, "medium");
  assert.deepEqual(o.allowedTools, [...BUILDER_TOOLS]);
  assert.deepEqual(o.settingSources, []);
  assert.equal(o.permissionMode, "dontAsk");
  assert.equal(o.maxTurns, 30);
  assert.equal(o.maxBudgetUsd, 2);
  assert.equal(o.pathToClaudeCodeExecutable, "/bin/claude");
  assert.equal((o.env as Record<string, string>).CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
});

test("la raíz de la política es cwd: package.json se deniega y el fichero del plan pasa", async () => {
  const { seen, query } = fake([
    { tool_name: "Write", tool_input: { file_path: "/w/tree/package.json" } },
    { tool_name: "Write", tool_input: { file_path: "/w/tree/src/a.ts" } },
  ]);
  const lines = await collect(runBuilder(RUN, query));
  assert.equal(denies(seen.outputs[0]), true);
  assert.deepEqual(seen.outputs[1], {});
  const denied = lines.filter((l) => l.kind === "denied");
  assert.equal(denied.length, 1);
  assert.equal(denied[0]?.payload.tool, "Write");
});

test("si la política lanza, el hook deniega y queda un denied", async () => {
  const broken = { ...RUN, policy: { ...RUN.policy, existingTests: null as never } };
  const { seen, query } = fake([
    { tool_name: "Write", tool_input: { file_path: "/w/tree/src/a.ts" } },
  ]);
  const lines = await collect(runBuilder(broken, query));
  assert.equal(denies(seen.outputs[0]), true);
  assert.equal(lines.filter((l) => l.kind === "denied").length, 1);
});

test("el último evento es usage, con el motivo de parada", async () => {
  const { query } = fake([{ tool_name: "Read", tool_input: { file_path: "src/a.ts" } }]);
  const lines = await collect(runBuilder(RUN, query));
  assert.equal(lines.at(-1)?.kind, "usage");
  assert.equal(lines.at(-1)?.payload.stop, "ok");
  assert.equal(lines.at(-1)?.payload.costUsd, 0.1);
});
