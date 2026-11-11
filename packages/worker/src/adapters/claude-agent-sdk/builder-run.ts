import { isAbsolute } from "node:path";
import { BUILDER_TOOLS, type BuilderPolicy, builderHook } from "./builder-policy.ts";
import type { AgentLine } from "./planner-policy.ts";
import { agentLines, type QueryFn, sdkOptions } from "./run.ts";

/** Copia de `EFFORTS` de core: este módulo se carga dentro del sandbox, que no ve `packages/core`. */
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export interface BuilderRun {
  prompt: string;
  /** El árbol del clon, absoluto. Es también la raíz de la política: nunca sale de la entrada. */
  cwd: string;
  model: string;
  effort: (typeof EFFORTS)[number];
  maxTurns: number;
  maxBudgetUsd: number;
  executable?: string;
  policy: Omit<BuilderPolicy, "root">;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v !== "";
const isTexts = (v: unknown) => Array.isArray(v) && v.every(isText);
const isPositive = (v: unknown) => typeof v === "number" && v > 0 && v < Infinity;

/** Valida a mano (no hay zod en el sandbox) y copia solo los campos conocidos; `null` si no vale. */
export function parseBuilderRun(raw: unknown): BuilderRun | null {
  if (!isObj(raw) || !isObj(raw.policy) || !isObj(raw.policy.checks)) return null;
  const { prompt, cwd, model, effort, maxTurns, maxBudgetUsd, executable } = raw;
  const { checks, planFiles, existingTests, protectedPaths } = raw.policy;
  const valid =
    isText(prompt) &&
    isText(model) &&
    isText(cwd) &&
    isAbsolute(cwd) &&
    EFFORTS.includes(effort as never) &&
    Number.isInteger(maxTurns) &&
    isPositive(maxTurns) &&
    isPositive(maxBudgetUsd) &&
    (executable === undefined || isText(executable)) &&
    Object.values(checks).every((c) => c === null || isText(c)) &&
    isTexts(planFiles) &&
    isTexts(existingTests) &&
    isTexts(protectedPaths);
  if (!valid) return null;
  const policy = { checks, planFiles, existingTests, protectedPaths };
  const run = { prompt, cwd, model, effort, maxTurns, maxBudgetUsd, policy };
  return (executable === undefined ? run : { ...run, executable }) as BuilderRun;
}

/**
 * Lanza al builder con el SDK inyectado: este módulo no lo importa, para cargarse en el sandbox sin
 * `node_modules`. La raíz de la política es `cwd`, y si la política lanza, el hook deniega.
 */
export async function* runBuilder(run: BuilderRun, query: QueryFn): AsyncGenerator<AgentLine> {
  const denied: AgentLine[] = [];
  const hook = builderHook({ ...run.policy, root: run.cwd }, (l) => denied.push(l));
  const reason = "la política del builder falló: se deniega";
  const closed = (input: Parameters<typeof hook>[0]) =>
    hook(input).catch(() => {
      denied.push({ kind: "denied", payload: { tool: input.tool_name ?? "", reason } });
      const out = { hookEventName: "PreToolUse", permissionDecision: "deny" } as const;
      return { hookSpecificOutput: { ...out, permissionDecisionReason: reason } };
    });
  const options = { ...sdkOptions(run, BUILDER_TOOLS, closed), effort: run.effort };
  yield* agentLines(query({ prompt: run.prompt, options }), denied);
}
