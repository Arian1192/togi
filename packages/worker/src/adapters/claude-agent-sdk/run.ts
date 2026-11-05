import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { type AgentLine, PLANNER_TOOLS, plannerHook } from "./planner-policy.ts";

export interface PlannerRun {
  prompt: string;
  cwd: string;
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
}

export const DEFAULT_LIMITS = { maxTurns: 20, maxBudgetUsd: 1 } as const;

export type StopReason = "ok" | "max_turns" | "max_budget" | "error";

// biome-ignore lint/suspicious/noExplicitAny: el SDK se simula en los tests
export type QueryFn = (params: { prompt: string; options: any }) => AsyncIterable<any>;

/**
 * Lanza al planificador con el SDK y devuelve sus acciones normalizadas. El último evento es `usage`,
 * con el uso real y por qué paró. `settingSources` vacío: la configuración la decide togi, no el repo.
 * Telemetría: el SDK no tiene opción tipada; se pasa la variable del cliente (sin confirmar que la
 * respete, PR 17) y la red del sandbox solo admite api.anthropic.com.
 */
export async function* runPlanner(
  run: PlannerRun,
  query: QueryFn = sdkQuery as QueryFn,
): AsyncGenerator<AgentLine> {
  const denied: AgentLine[] = [];
  const stream = query({
    prompt: run.prompt,
    options: {
      cwd: run.cwd,
      model: run.model,
      settingSources: [],
      permissionMode: "dontAsk",
      allowedTools: [...PLANNER_TOOLS],
      maxTurns: run.maxTurns,
      maxBudgetUsd: run.maxBudgetUsd,
      env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
      hooks: { PreToolUse: [{ hooks: [plannerHook((l) => denied.push(l))] }] },
    },
  });
  let stop: StopReason = "error";
  let usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0 };
  for await (const message of stream) {
    yield* denied.splice(0);
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") yield { kind: "message", payload: { text: block.text } };
        if (block.type === "tool_use") {
          yield { kind: "tool_call", payload: { tool: block.name, input: block.input } };
        }
      }
    } else if (message.type === "user" && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type === "tool_result") {
          yield { kind: "tool_result", payload: { isError: block.is_error === true } };
        }
      }
    } else if (message.type === "result") {
      stop = STOPS[message.subtype as string] ?? "error";
      usage = {
        inputTokens: message.usage?.input_tokens ?? 0,
        outputTokens: message.usage?.output_tokens ?? 0,
        costUsd: message.total_cost_usd ?? 0,
        turns: message.num_turns ?? 0,
      };
    }
  }
  yield* denied.splice(0);
  yield { kind: "usage", payload: { ...usage, stop } };
}

const STOPS: Record<string, StopReason> = {
  success: "ok",
  error_max_turns: "max_turns",
  error_max_budget_usd: "max_budget",
};
