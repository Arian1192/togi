import { parseArgs } from "node:util";
import type { Command } from "./commands/index.ts";
import { usageError } from "./errors.ts";

type Commands = Record<string, Record<string, Command>>;

/** Opciones que acepta todo comando. */
export const OPTIONS = {
  help: { type: "boolean", short: "h" },
  json: { type: "boolean" },
  "no-color": { type: "boolean" },
} as const;

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

export function help(commands: Commands, resource?: string): string {
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
export function parseCommandLine(argv: string[], commands: Commands): Parsed {
  const probe = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: false });
  const [resource, verb] = probe.positionals;
  const verbs = resource === undefined ? undefined : commands[resource];
  const command = verb === undefined ? undefined : verbs?.[verb];
  if (probe.values.help === true || resource === undefined) {
    return { kind: "help", text: command?.usage ?? help(commands, resource) };
  }
  const typed = `togi ${probe.positionals.join(" ")}`;
  if (verbs === undefined) {
    const suggestion = closest(resource, Object.keys(commands));
    throw usageError("unknown_command", {
      command: typed,
      ...(suggestion && { suggestion: `togi ${suggestion}` }),
    });
  }
  if (verb === undefined || command === undefined) {
    const suggestion = verb && closest(verb, Object.keys(verbs));
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
    args: positionals.slice(2),
  };
}
