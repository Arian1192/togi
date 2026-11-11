import { type AgentLine, PLANNER_TOOLS, plannerHook } from "./planner-policy.ts";

export interface PlannerRun {
  prompt: string;
  cwd: string;
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
  /**
   * Ejecutable nativo del SDK, resuelto por el daemon fuera del sandbox. Dentro no se busca nada:
   * la búsqueda del SDK no encuentra el binario de pnpm desde aquí.
   */
  executable?: string;
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
export async function* runPlanner(run: PlannerRun, query?: QueryFn): AsyncGenerator<AgentLine> {
  // El SDK se carga solo si no lo inyectan: así este módulo se importa sin `node_modules`.
  const sdk = query ?? ((await import("@anthropic-ai/claude-agent-sdk")).query as QueryFn);
  const denied: AgentLine[] = [];
  const hook = plannerHook((l) => denied.push(l));
  yield* agentLines(
    sdk({ prompt: run.prompt, options: sdkOptions(run, PLANNER_TOOLS, hook) }),
    denied,
  );
}

/** Las opciones del SDK comunes al planificador y al builder. */
export const sdkOptions = (run: PlannerRun, tools: readonly string[], hook: unknown) => ({
  cwd: run.cwd,
  model: run.model,
  ...(run.executable === undefined ? {} : { pathToClaudeCodeExecutable: run.executable }),
  settingSources: [],
  permissionMode: "dontAsk",
  allowedTools: [...tools],
  maxTurns: run.maxTurns,
  maxBudgetUsd: run.maxBudgetUsd,
  env: {
    ...process.env,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    // El binario crea `claude-<uid>` en /tmp, que el sandbox no deja escribir: se le da el
    // directorio desechable de la sesión, que el sandbox pone como HOME.
    ...(process.env.HOME === undefined ? {} : { CLAUDE_CODE_TMPDIR: process.env.HOME }),
  },
  hooks: { PreToolUse: [{ hooks: [hook] }] },
});

/** Traduce los mensajes del SDK a `AgentLine`; los `denied` del hook salen antes del siguiente. */
export async function* agentLines(
  // biome-ignore lint/suspicious/noExplicitAny: los mensajes del SDK no se tipan aquí
  stream: AsyncIterable<any>,
  denied: AgentLine[],
): AsyncGenerator<AgentLine> {
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
