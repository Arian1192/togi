import { isAbsolute, relative, resolve, sep } from "node:path";
import { globMatcher } from "./glob.ts";
import type { AgentLine } from "./planner-policy.ts";

/**
 * Las herramientas del builder (ADR-003, `building`). Copia de `ROLE_TOOLS.builder` de core, a
 * propósito: este módulo se carga dentro del sandbox, que no puede leer `packages/core`. Un test
 * comprueba que no se desvían.
 */
export const BUILDER_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "Bash"] as const;

/** Todo lo que decide el hook llega como entrada: no toca el disco (ADR-008). */
export interface BuilderPolicy {
  /** La raíz del clon de la tarea, absoluta. */
  root: string;
  /** Los comandos de `checks` del perfil; `null` si el repo no tiene ese gate. */
  checks: Readonly<Record<string, string | null>>;
  /** Los `add` y `modify` del plan aprobado más sus `newTests`, relativos a `root`. */
  planFiles: readonly string[];
  /** Los tests que ya existen en el clon, relativos a `root`. */
  existingTests: readonly string[];
  /** Los globs protegidos: los mínimos de core más los del perfil. */
  protectedPaths: readonly string[];
}

export type BuilderDecision = { decision: "allow" } | { decision: "deny"; reason: string };

export interface ToolUse {
  tool_name?: string;
  tool_input?: unknown;
}

const allow: BuilderDecision = { decision: "allow" };
const deny = (reason: string): BuilderDecision => ({ decision: "deny", reason });

/** El alfabeto de un comando exacto del perfil (`repo-profile.ts`): fuera queda todo metacarácter. */
const COMMAND = /^[\w@%+=:,./-]+( [\w@%+=:,./-]+)*$/;

const field = (input: unknown, key: string): unknown =>
  typeof input === "object" && input !== null ? (input as Record<string, unknown>)[key] : undefined;

/** Orden (ADR-003): herramienta fuera de la lista, ruta protegida, test existente, fuera del plan. */
export function decideBuilderTool(policy: BuilderPolicy, input: ToolUse): BuilderDecision {
  const tool = input.tool_name ?? "";
  if (!(BUILDER_TOOLS as readonly string[]).includes(tool))
    return deny(`herramienta no permitida al builder: ${tool}`);
  if (tool === "Bash") return decideBash(policy, input.tool_input);
  if (tool === "Edit" || tool === "Write")
    return decidePath(policy, field(input.tool_input, "file_path"));
  return allow;
}

function decideBash(policy: BuilderPolicy, toolInput: unknown): BuilderDecision {
  const background = field(toolInput, "run_in_background");
  if (background !== undefined && background !== false)
    return deny("Bash en segundo plano no está permitido");
  const command = field(toolInput, "command");
  if (typeof command !== "string" || !COMMAND.test(command))
    return deny("Bash solo admite un comando exacto, sin metacaracteres");
  const checks = Object.values(policy.checks).filter((check): check is string => check !== null);
  const base = checks.find((check) => command === check || command.startsWith(`${check} `));
  if (base === undefined) return deny("Bash solo admite los comandos de checks del perfil");
  const args = command.slice(base.length).split(" ").filter(Boolean);
  const bad = args.find(
    (arg) => arg.startsWith("-") || arg.startsWith("/") || arg.split("/").includes(".."),
  );
  return bad === undefined
    ? allow
    : deny(`argumento no permitido: ${bad}; solo rutas relativas del repo`);
}

function decidePath(policy: BuilderPolicy, filePath: unknown): BuilderDecision {
  if (typeof filePath !== "string" || filePath === "") return deny("falta file_path");
  if (filePath.split(/[\\/]/).includes("..")) return deny('la ruta no admite segmentos ".."');
  const rel = relative(policy.root, resolve(policy.root, filePath));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return deny("la ruta sale del repo");
  const path = rel.split(sep).join("/");
  if (globMatcher(policy.protectedPaths)(path)) return deny(`ruta protegida: ${path}`);
  const lower = path.toLowerCase();
  if (policy.existingTests.some((test) => test.toLowerCase() === lower))
    return deny(`test existente: ${path}`);
  if (!policy.planFiles.includes(path)) return deny(`fuera del plan aprobado: ${path}`);
  return allow;
}

export interface HookOutput {
  hookSpecificOutput?: {
    hookEventName: "PreToolUse";
    permissionDecision: "deny";
    permissionDecisionReason: string;
  };
}

/** Hook `PreToolUse` del builder: cada rechazo queda en la trayectoria como `denied`. */
export function builderHook(policy: BuilderPolicy, record: (line: AgentLine) => void) {
  return async (input: { hook_event_name: string } & ToolUse): Promise<HookOutput> => {
    const result = decideBuilderTool(policy, input);
    if (result.decision === "allow") return {};
    record({ kind: "denied", payload: { tool: input.tool_name ?? "", reason: result.reason } });
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason: result.reason,
      },
    };
  };
}
