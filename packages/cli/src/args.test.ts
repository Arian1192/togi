import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommandLine } from "./args.ts";
import type { Command } from "./commands/index.ts";
import type { CliError } from "./errors.ts";

const make = (extra: Partial<Command> = {}): Command => ({
  summary: "Hace algo.",
  example: "togi cosa hacer",
  run: async () => "",
  ...extra,
});
const hacer = make({
  usage: "Uso: togi cosa hacer\n",
  options: { risk: { type: "string", short: "r" }, force: { type: "boolean" } },
});
const COMMANDS = { cosa: { hacer, otro: make() } };

const run = (...argv: string[]) => {
  const parsed = parseCommandLine(argv, COMMANDS);
  assert.equal(parsed.kind, "run");
  return parsed as Extract<typeof parsed, { kind: "run" }>;
};

test("el comando recibe sus valores y sus argumentos, con flags delante o detrás", () => {
  const a = run("cosa", "hacer", "texto", "--risk", "low", "--force");
  assert.equal(a.command, hacer);
  assert.deepEqual(a.values.risk, "low");
  assert.equal(a.values.force, true);
  assert.deepEqual(a.args, ["texto"]);
  const b = run("cosa", "hacer", "-r", "high", "uno", "dos");
  assert.equal(b.values.risk, "high");
  assert.deepEqual(b.args, ["uno", "dos"]);
});

test("las opciones globales siguen valiendo y --json se separa", () => {
  const p = run("cosa", "otro", "--json", "--no-color");
  assert.equal(p.json, true);
  assert.deepEqual(p.args, []);
});

test("un flag que el comando no declara falla con ERR_PARSE_ARGS", () => {
  assert.throws(() => parseCommandLine(["cosa", "otro", "--risk", "low"], COMMANDS), {
    code: "ERR_PARSE_ARGS_UNKNOWN_OPTION",
  });
  assert.throws(() => parseCommandLine(["cosa", "hacer", "--risk"], COMMANDS), {
    code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
  });
});

test("--help da el uso del comando si lo tiene, y si no el del recurso", () => {
  const own = parseCommandLine(["cosa", "hacer", "--help"], COMMANDS);
  assert.deepEqual(own, { kind: "help", text: "Uso: togi cosa hacer\n" });
  const resource = parseCommandLine(["cosa", "otro", "-h"], COMMANDS);
  assert.match((resource as { text: string }).text, /togi cosa hacer {2}Hace algo\./);
  assert.match(
    (parseCommandLine([], COMMANDS) as { text: string }).text,
    /Ejemplo: togi cosa hacer/,
  );
});

test("un recurso o verbo desconocido sugiere el parecido", () => {
  const fail = (argv: string[]) => {
    try {
      parseCommandLine(argv, COMMANDS);
    } catch (error) {
      return error as CliError;
    }
    return assert.fail("debía fallar");
  };
  assert.equal(fail(["cosas", "hacer"]).context.suggestion, "togi cosa");
  assert.equal(fail(["cosa", "hacr"]).context.suggestion, "togi cosa hacer");
  assert.equal(fail(["cosa", "hacr"]).exitCode, 2);
  assert.equal(fail(["zzzzzz"]).context.suggestion, undefined);
});

test("un atajo se enruta sin recurso y recibe todos sus argumentos", () => {
  const estado = make({
    usage: "Uso: togi estado\n",
    options: { all: { type: "boolean" } },
  });
  const shortcuts = { estado };
  const p = parseCommandLine(["estado", "uno", "--all", "--json"], COMMANDS, shortcuts);
  assert.equal(p.kind, "run");
  const r = p as Extract<typeof p, { kind: "run" }>;
  assert.equal(r.command, estado);
  assert.equal(r.values.all, true);
  assert.equal(r.json, true);
  assert.deepEqual(r.args, ["uno"]);
  assert.deepEqual(parseCommandLine(["estado", "-h"], COMMANDS, shortcuts), {
    kind: "help",
    text: "Uso: togi estado\n",
  });
});

test("la ayuda general lista los atajos y un atajo mal escrito sugiere el parecido", () => {
  const shortcuts = { estado: make({ summary: "Muestra el estado." }) };
  const general = parseCommandLine([], COMMANDS, shortcuts) as { text: string };
  assert.match(general.text, /togi estado {2}Muestra el estado\./);
  assert.throws(
    () => parseCommandLine(["estdo"], COMMANDS, shortcuts),
    (e: CliError) => e.context.suggestion === "togi estado",
  );
});
