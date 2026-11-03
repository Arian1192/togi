import assert from "node:assert/strict";
import { test } from "node:test";
import { createOutput } from "./output.ts";

const UTF8 = { LANG: "es_ES.UTF-8" };
const make = (
  over: Partial<Parameters<typeof createOutput>[0]> = {},
  env: Record<string, string | undefined> = UTF8,
) => createOutput({ env, isTTY: true, noColorFlag: false, ...over });

test("en una terminal pinta cada token con su color", () => {
  const out = make();
  assert.equal(out.paint("ok", "x"), "\x1b[32mx\x1b[0m");
  assert.equal(out.paint("attention", "x"), "\x1b[33mx\x1b[0m");
  assert.equal(out.paint("error", "x"), "\x1b[31mx\x1b[0m");
  assert.equal(out.paint("muted", "x"), "\x1b[90mx\x1b[0m");
  assert.equal(out.paint("accent", "x"), "\x1b[36mx\x1b[0m");
});

test("sin terminal no hay códigos de color", () => {
  assert.equal(make({ isTTY: false }).paint("error", "x"), "x");
});

test("NO_COLOR y --no-color apagan el color", () => {
  assert.equal(make({}, { ...UTF8, NO_COLOR: "1" }).paint("ok", "x"), "x");
  assert.equal(make({ noColorFlag: true }).paint("ok", "x"), "x");
});

test("NO_COLOR vacío no cuenta (no-color.org)", () => {
  assert.equal(make({}, { ...UTF8, NO_COLOR: "" }).color, true);
});

test("FORCE_COLOR fuerza el color sin terminal, pero no vence a NO_COLOR ni a --no-color", () => {
  const forced = { ...UTF8, FORCE_COLOR: "1" };
  assert.equal(make({ isTTY: false }, forced).color, true);
  assert.equal(make({ isTTY: false }, { ...forced, NO_COLOR: "1" }).color, false);
  assert.equal(make({ isTTY: false, noColorFlag: true }, forced).color, false);
  assert.equal(make({ isTTY: false }, { ...UTF8, FORCE_COLOR: "0" }).color, false);
});

test("símbolos Unicode con locale UTF-8", () => {
  const out = make({ isTTY: false });
  assert.deepEqual(
    (["ok", "attention", "error", "muted", "accent"] as const).map((t) => out.symbol(t)),
    ["✓", "●", "✗", "·", ""],
  );
});

test("alternativa ASCII con TERM=dumb o locale que no es UTF-8", () => {
  const ascii = ["ok", "*", "x", "-", ""];
  for (const env of [
    { ...UTF8, TERM: "dumb" },
    { LANG: "C" },
    {},
    { LC_ALL: "C", LANG: UTF8.LANG },
  ]) {
    const out = make({}, env);
    assert.deepEqual(
      (["ok", "attention", "error", "muted", "accent"] as const).map((t) => out.symbol(t)),
      ascii,
      JSON.stringify(env),
    );
  }
});

test("mark une símbolo y texto y pinta el conjunto", () => {
  assert.equal(make({ isTTY: false }).mark("ok", "Hecho"), "✓ Hecho");
  assert.equal(make().mark("error", "Mal"), "\x1b[31m✗ Mal\x1b[0m");
  assert.equal(make({ isTTY: false }).mark("accent", "#12"), "#12");
});
