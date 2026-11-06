import assert from "node:assert/strict";
import { test } from "node:test";
import { type ParseArgsConfig, parseArgs } from "node:util";
import { usageFromParseError } from "./args.ts";
import { COMMANDS, SHORTCUTS } from "./commands/index.ts";
import { type CliError, renderError } from "./errors.ts";
import { createOutput } from "./output.ts";
import { runCli } from "./testing/run-cli.ts";

const out = createOutput({ env: { LANG: "es_ES.UTF-8" }, isTTY: false, noColorFlag: true });

/** El error real que lanza `parseArgs` para esa línea, convertido como lo hace main.ts. */
function converted(argv: string[]): CliError {
  const options: ParseArgsConfig["options"] = {
    risk: { type: "string", short: "r" },
    json: { type: "boolean" },
  };
  try {
    parseArgs({ args: argv, options, allowPositionals: true });
  } catch (error) {
    return usageFromParseError(error as Error, argv, COMMANDS, SHORTCUTS);
  }
  return assert.fail("parseArgs debía fallar");
}
const text = (e: CliError) => renderError(e, out);

test("una opción desconocida se nombra en español y remite a la ayuda del comando", () => {
  const e = converted(["task", "new", "--foo"]);
  assert.deepEqual([e.code, e.exitCode, e.context.field], ["unknown_option", 2, "--foo"]);
  assert.equal(
    text(e),
    "✗ Opción desconocida: --foo.\n  Mira las opciones con: togi task new --help\n  unknown_option\n",
  );
});

test("un atajo remite a su propia ayuda y un recurso sin verbo, a la del recurso", () => {
  assert.equal(converted(["watch", "--foo"]).context.command, "togi watch --help");
  assert.equal(converted(["task", "--foo"]).context.command, "togi task --help");
});

test("una opción corta desconocida también se nombra", () => {
  assert.equal(converted(["task", "new", "-x"]).context.field, "-x");
});

test("falta el valor de una opción: se nombra la larga", () => {
  const e = converted(["task", "new", "--risk"]);
  assert.equal(e.code, "option_value_missing");
  assert.match(text(e), /^✗ Falta el valor de --risk\.\n {2}Mira el uso con: togi task new --help/);
});

test("un valor que empieza por guion se explica con el modo de escribirlo", () => {
  const e = converted(["task", "new", "--risk", "--json"]);
  assert.equal(e.code, "option_value_ambiguous");
  assert.match(text(e), /empieza por «-».*--risk=-valor/);
});

test("un flag sin valor al que se le da uno", () => {
  const e = converted(["task", "new", "--json=1"]);
  assert.equal(e.code, "option_value_unexpected");
  assert.match(text(e), /^✗ --json no admite un valor\./);
});

test("el valor que acompaña al flag nunca se repite", () => {
  const e = converted(["task", "new", "--foo=sk-ant-valor-secreto"]);
  assert.ok(!text(e).includes("valor-secreto"));
  assert.equal(e.context.field, "--foo");
});

test("en auth no se nombra ninguna opción: podría ser el secreto", () => {
  const e = converted(["auth", "set-api-key", "--sk-ant-secreto"]);
  assert.equal(e.code, "invalid_usage");
  assert.equal(e.context.field, undefined);
  assert.ok(!text(e).includes("secreto"));
  assert.match(text(e), /Mira el uso con: togi auth set-api-key --help/);
});

test("un error que no es de opciones queda como uso incorrecto", () => {
  const e = usageFromParseError(
    Object.assign(new Error("otra cosa"), { code: "ERR_X" }),
    ["watch"],
    COMMANDS,
    SHORTCUTS,
  );
  assert.equal(e.code, "invalid_usage");
});

test("desde la CLI real: sale con 2, en español, sin inglés ni traza", async () => {
  for (const [args, esperado] of [
    [["watch", "--foo"], /Opción desconocida: --foo\./],
    [["task", "new", "--risk"], /Falta el valor de --risk\./],
    [["status", "--json=1"], /--json no admite un valor\./],
  ] as const) {
    // Sin --no-color: no hay terminal y no pinta colores, y detrás de --risk se leería como su valor.
    const r = await runCli([...args], "/nonexistent-togi-home");
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.stderr, esperado);
    assert.doesNotMatch(
      r.stderr,
      /Unknown option|argument missing|does not take|ERR_PARSE|\n\s+at /,
    );
    assert.equal(r.stdout, "");
  }
});
