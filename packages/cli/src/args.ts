import { parseArgs } from "node:util";
import type { Command } from "./commands/index.ts";
import { type CliError, usageError } from "./errors.ts";

type Commands = Record<string, Record<string, Command>>;
/** Atajos `togi <verbo>`: un comando sin recurso. */
type Shortcuts = Record<string, Command>;

/** Opciones que acepta todo comando. */
export const OPTIONS = {
  help: { type: "boolean", short: "h" },
  json: { type: "boolean" },
  "no-color": { type: "boolean" },
} as const;

/**
 * El error de `parseArgs` (en inglés) como un error de uso en español que dice qué opción falló y
 * dónde mirar el uso del comando. Solo se nombra el flag, nunca su valor. En `auth` no se nombra
 * nada: el texto que escribió la persona podría ser el secreto.
 */
export function usageFromParseError(
  error: Error & { code?: string },
  argv: string[],
  commands: Commands,
  shortcuts: Shortcuts = {},
): CliError {
  const [resource, verb] = parseArgs({
    args: argv,
    options: OPTIONS,
    allowPositionals: true,
    strict: false,
  }).positionals;
  const path =
    resource === undefined
      ? "togi"
      : shortcuts[resource] !== undefined || commands[resource]?.[verb ?? ""] === undefined
        ? `togi ${resource}`
        : `togi ${resource} ${verb}`;
  const command = `${path} --help`;
  if (resource === "auth") return usageError("invalid_usage", { command });
  const names = error.message.match(/-{1,2}[A-Za-z0-9][A-Za-z0-9-]*/g) ?? [];
  const field = names.find((n) => n.startsWith("--")) ?? names[0];
  const named = field === undefined ? {} : { field };
  if (error.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
    return usageError("unknown_option", { ...named, command });
  }
  if (error.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") {
    const why = error.message.includes("missing")
      ? "option_value_missing"
      : error.message.includes("ambiguous")
        ? "option_value_ambiguous"
        : "option_value_unexpected";
    return usageError(why, { ...named, command });
  }
  return usageError("invalid_usage", { command });
}

/** Distancia de edición (Levenshtein) para sugerir el comando parecido. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        (row[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length] ?? 0;
}

const closest = (word: string, options: string[]): string | undefined =>
  options.find((o) => distance(word, o) <= 2);

export function help(commands: Commands, resource?: string, shortcuts: Shortcuts = {}): string {
  const entries = Object.entries(commands).filter(
    ([name]) => resource === undefined || name === resource,
  );
  const lines = ["Uso: togi <recurso> <verbo> [--json] [--no-color]", ""];
  for (const [name, verbs] of entries) {
    for (const [verb, c] of Object.entries(verbs))
      lines.push(`  togi ${name} ${verb}  ${c.summary}`);
    const example = Object.values(verbs)[0]?.example;
    if (example !== undefined) lines.push("", `Ejemplo: ${example}`);
  }
  if (resource === undefined) {
    for (const [name, c] of Object.entries(shortcuts)) lines.push(`  togi ${name}  ${c.summary}`);
  }
  return `${lines.join("\n")}\n`;
}

export type Parsed =
  | { kind: "help"; text: string }
  | {
      kind: "run";
      command: Command;
      json: boolean;
      values: Record<string, string | boolean | undefined>;
      args: string[];
    };

/**
 * Interpreta la línea de comandos. Primera pasada, sin rigor: localiza recurso y verbo para saber
 * qué opciones declara el comando. Segunda, en estricto, con las globales más las del comando; un
 * flag desconocido lanza el error de `parseArgs` (`ERR_PARSE_ARGS_*`).
 */
export function parseCommandLine(
  argv: string[],
  commands: Commands,
  shortcuts: Shortcuts = {},
): Parsed {
  const probe = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: false });
  const [resource, verb] = probe.positionals;
  const shortcut = resource === undefined ? undefined : shortcuts[resource];
  const verbs = resource === undefined ? undefined : commands[resource];
  const command = shortcut ?? (verb === undefined ? undefined : verbs?.[verb]);
  if (probe.values.help === true || resource === undefined) {
    return { kind: "help", text: command?.usage ?? help(commands, resource, shortcuts) };
  }
  // En `auth` un positional podría ser el secreto: no se repite.
  const typed = resource === "auth" ? "togi auth" : `togi ${probe.positionals.join(" ")}`;
  if (verbs === undefined && shortcut === undefined) {
    const suggestion = closest(resource, [...Object.keys(commands), ...Object.keys(shortcuts)]);
    throw usageError("unknown_command", {
      command: typed,
      ...(suggestion && { suggestion: `togi ${suggestion}` }),
    });
  }
  if (command === undefined) {
    const suggestion = verb && closest(verb, Object.keys(verbs ?? {}));
    throw usageError("unknown_command", {
      command: typed,
      ...(suggestion && { suggestion: `togi ${resource} ${suggestion}` }),
    });
  }
  const { values, positionals } = parseArgs({
    args: argv,
    options: { ...OPTIONS, ...command.options },
    allowPositionals: true,
  });
  return {
    kind: "run",
    command,
    json: values.json === true,
    values,
    args: positionals.slice(shortcut === undefined ? 2 : 1),
  };
}
