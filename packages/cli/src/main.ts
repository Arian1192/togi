import { parseArgs } from "node:util";
import { resolveHome } from "@togi/daemon/config";
import { COMMANDS } from "./commands/index.ts";
import { CliError, renderError, usageError } from "./errors.ts";
import { createOutput } from "./output.ts";

const OPTIONS = {
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

function help(resource?: string): string {
  const entries = Object.entries(COMMANDS).filter(
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

async function main(): Promise<number> {
  const env = process.env;
  const errorOut = (noColorFlag: boolean) =>
    createOutput({ env, isTTY: process.stderr.isTTY === true, noColorFlag });
  let noColorFlag = false;
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: OPTIONS,
      allowPositionals: true,
    });
    noColorFlag = values["no-color"] === true;
    const [resource, verb] = positionals;
    if (values.help === true || resource === undefined) {
      process.stdout.write(help(resource));
      return 0;
    }
    const verbs = COMMANDS[resource];
    if (verbs === undefined) {
      const suggestion = closest(resource, Object.keys(COMMANDS));
      throw usageError("unknown_command", {
        command: `togi ${positionals.join(" ")}`,
        ...(suggestion && { suggestion: `togi ${suggestion}` }),
      });
    }
    const command = verb === undefined ? undefined : verbs[verb];
    if (verb === undefined || command === undefined) {
      const suggestion = verb && closest(verb, Object.keys(verbs));
      throw usageError("unknown_command", {
        command: `togi ${positionals.join(" ")}`,
        ...(suggestion && { suggestion: `togi ${resource} ${suggestion}` }),
      });
    }
    const out = createOutput({ env, isTTY: process.stdout.isTTY === true, noColorFlag });
    process.stdout.write(
      await command.run({ home: resolveHome(env), json: values.json === true, out }),
    );
    return 0;
  } catch (error) {
    const cli =
      error instanceof CliError
        ? error
        : (error as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS")
          ? usageError("usage", { command: (error as Error).message })
          : null;
    if (cli === null) throw error;
    process.stderr.write(renderError(cli, errorOut(noColorFlag)));
    return cli.exitCode;
  }
}

process.exitCode = await main();
