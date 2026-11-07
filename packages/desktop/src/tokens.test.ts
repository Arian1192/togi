import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SRC = import.meta.dirname;
const css = readFileSync(join(SRC, "tokens.css"), "utf8");
const tokens = JSON.parse(
  readFileSync(join(SRC, "..", "..", "..", "docs", "marca", "tokens.json"), "utf8"),
) as {
  color: { tokens: { name: string; value: string | { dark: string; light: string } }[] };
  type: { families: Record<string, string> };
  spacing: { tokens: { name: string; value: string }[] };
  radius: { tokens: { name: string; value: string }[] };
};

type Theme = "light" | "dark";
type Declarations = Map<string, string>;

/** Las declaraciones `--x: valor` de un bloque de CSS. */
const declarations = (body: string): Declarations =>
  new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] ?? "", m[2] ?? ""]));

const block = (selector: string, from = css): Declarations => {
  const start = from.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `falta el bloque ${selector}`);
  return declarations(from.slice(start, from.indexOf("}", start)));
};

const media = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
const base = block(':root,\n:root[data-theme="light"]');
const dark = block(':root[data-theme="dark"]');
const mediaDark = block(':root:not([data-theme="light"])', media);

/** Lo que vale cada variable en un tema, siguiendo la cascada y los var(--x). */
function computed(layers: Declarations[]): (name: string) => string {
  const all: Declarations = new Map();
  for (const layer of layers) for (const [k, v] of layer) all.set(k, v);
  const get = (name: string): string => {
    const value = all.get(name);
    assert.ok(value !== undefined, `falta ${name}`);
    const ref = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
    return ref === undefined ? value.toLowerCase() : get(ref);
  };
  return get;
}

// La paleta son los colores con valor hexadecimal; el resto son tokens semánticos (y `done`, que
// remite a otro).
const isHex = (value: string | object): value is string =>
  typeof value === "string" && value.startsWith("#");
const palette = new Map(
  tokens.color.tokens.flatMap((t): [string, string][] =>
    isHex(t.value) ? [[t.name, t.value]] : [],
  ),
);
const semantic = tokens.color.tokens.filter((t) => !palette.has(t.name));

/** El valor de un token semántico en un tema, resolviendo las referencias `{nombre}` de tokens.json. */
function expected(name: string, theme: Theme): string {
  const token = tokens.color.tokens.find((t) => t.name === name);
  assert.ok(token !== undefined, name);
  const raw = typeof token.value === "string" ? token.value : token.value[theme];
  const ref = /^\{([\w-]+)\}$/.exec(raw)?.[1];
  if (ref === undefined) return raw.toLowerCase();
  return palette.has(ref) ? (palette.get(ref) ?? "").toLowerCase() : expected(ref, theme);
}

const scenarios: [string, Theme, Declarations[]][] = [
  ["tema claro por defecto", "light", [base]],
  ['data-theme="dark"', "dark", [base, dark]],
  ["prefers-color-scheme: dark", "dark", [base, mediaDark]],
];

for (const [name, theme, layers] of scenarios) {
  test(`${name}: están todos los tokens de color de tokens.json con su valor`, () => {
    const get = computed(layers);
    assert.ok(semantic.length >= 8);
    for (const { name: token } of semantic) assert.equal(get(`--${token}`), expected(token, theme));
  });
}

test("los dos temas oscuros (atributo y preferencia del sistema) son idénticos", () => {
  assert.deepEqual([...mediaDark], [...dark]);
});

test("las familias, el espaciado y los radios son los de tokens.json", () => {
  const root = block(":root", css.slice(css.lastIndexOf(":root {")));
  const wanted = [
    ...Object.entries(tokens.type.families).map(([k, v]) => [`--font-${k}`, v]),
    ...[...tokens.spacing.tokens, ...tokens.radius.tokens].map((t) => [`--${t.name}`, t.value]),
  ];
  assert.ok(wanted.length >= 13);
  for (const [name, value] of wanted) assert.equal(root.get(name ?? ""), value, name);
});

test("ningún componente escribe un hexadecimal: solo tokens.css los tiene", () => {
  for (const file of ["app.css", "App.tsx"]) {
    assert.doesNotMatch(readFileSync(join(SRC, file), "utf8"), /#[0-9a-f]{3,8}\b/i, file);
  }
});
