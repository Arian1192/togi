import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SRC = import.meta.dirname;
const ROOT = join(SRC, "..");
const FONTS = join(SRC, "fonts");
const fontsCss = readFileSync(join(SRC, "fonts.css"), "utf8");
const faces = [...fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1] ?? "");
const prop = (face: string, name: string) =>
  new RegExp(`${name}:\\s*([^;]+);`).exec(face)?.[1]?.trim() ?? "";

const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((f) =>
  /\.(css|tsx?)$/.test(f),
);

test("ninguna fuente se pide a la red: todo src es un fichero local de fonts/", () => {
  const urls = [...fontsCss.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1] ?? "");
  assert.equal(urls.length, faces.length);
  for (const url of urls) assert.match(url, /^"\.\/fonts\/[\w-]+\.woff2"$/, url);
  assert.doesNotMatch(fontsCss, /@import|https?:|\/\/[a-z]/i);
});

test("ni el código ni la página enlazan fuentes de Google ni de ningún origen remoto", () => {
  const own = sources.filter((f) => !f.endsWith(".test.ts"));
  const files = [...own.map((f) => join(SRC, f)), join(ROOT, "index.html")];
  for (const file of files) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /fonts\.g(oogleapis|static)|@import url/i,
      file,
    );
  }
});

test("las fuentes nunca se incrustan en data: URI, que la CSP (font-src 'self') bloquearía", () => {
  assert.match(readFileSync(join(ROOT, "vite.config.ts"), "utf8"), /assetsInlineLimit:\s*0/);
  const conf = readFileSync(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8");
  assert.match(conf, /font-src 'self';/);
});

test("cada fuente declarada existe y es un woff2, y no sobra ninguna", () => {
  const declared = [...fontsCss.matchAll(/fonts\/([\w-]+\.woff2)/g)].map((m) => m[1]);
  const files = readdirSync(FONTS).filter((f) => f.endsWith(".woff2"));
  assert.deepEqual([...declared].sort(), [...files].sort());
  for (const f of files) {
    assert.equal(readFileSync(join(FONTS, f)).subarray(0, 4).toString("latin1"), "wOF2", f);
  }
});

test("solo están las familias y pesos del manual, cada uno con su trozo de latín", () => {
  const weights = new Map<string, Set<string>>();
  const latin = new Set<string>();
  for (const face of faces) {
    const family = prop(face, "font-family").replaceAll('"', "");
    const weight = prop(face, "font-weight");
    weights.set(family, (weights.get(family) ?? new Set()).add(weight));
    if (prop(face, "src").includes("-latin-")) latin.add(`${family} ${weight}`);
  }
  const wanted = {
    "Shippori Mincho": ["600"],
    "Zen Kaku Gothic New": ["400", "500"],
    "M PLUS 1 Code": ["400", "500"],
  };
  assert.deepEqual(Object.fromEntries([...weights].map(([k, v]) => [k, [...v].sort()])), wanted);
  for (const [family, ws] of Object.entries(wanted)) {
    for (const w of ws) assert.ok(latin.has(`${family} ${w}`), `${family} ${w} sin latín`);
  }
});

test("no hay solapes: ningún carácter está declarado en dos trozos del mismo peso", () => {
  const seen = new Map<string, number>();
  for (const face of faces.filter((f) => !prop(f, "src").includes("-latin-"))) {
    const key = `${prop(face, "font-family")}${prop(face, "font-weight")}`;
    for (const range of prop(face, "unicode-range").split(",")) {
      const [lo, hi = lo] = range
        .trim()
        .replace("U+", "")
        .split("-")
        .map((h) => parseInt(h, 16));
      for (let cp = lo ?? 0; cp <= (hi ?? 0); cp++) {
        const id = `${key}:${cp}`;
        assert.equal(seen.get(id), undefined, `U+${cp.toString(16)} repetido en ${key}`);
        seen.set(id, 1);
      }
    }
  }
});

test("la licencia OFL y el aviso de cada familia acompañan a las fuentes", () => {
  const license = readFileSync(join(FONTS, "LICENSE.md"), "utf8");
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1 - 26 February 2007/);
  assert.match(license, /The Shippori Mincho Project Authors/);
  assert.match(license, /The Zen Project Authors/);
  assert.match(license, /The M\+ FONTS Project Authors/);
});
