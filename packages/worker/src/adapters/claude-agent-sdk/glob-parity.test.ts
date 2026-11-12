import assert from "node:assert/strict";
import { test } from "node:test";
import { compileGlobs } from "@togi/core";
import { globMatcher } from "./glob.ts";

// El worker no puede cargar `core` dentro del sandbox, así que tiene su propia copia del matcher.
// Las dos tienen que dar lo mismo. La única diferencia es a propósito: ante un glob que no reconoce,
// el del worker lo casa todo y el de `core` devuelve null.

const GLOBS = [
  "**/a.ts",
  "src/**",
  "src/*.ts",
  "src/?.ts",
  "apps/**/*.test.{ts,tsx}",
  "**/.env*",
  "a+b.ts",
  "(x)/[y].ts",
];
const PATHS = [
  "a.ts",
  "x/y/a.ts",
  "src/a.ts",
  "src/ab.ts",
  "src/x/a.ts",
  "SRC/A.TS",
  "apps/api/src/x.test.ts",
  "apps/web/y.test.tsx",
  "apps/web/y.test.js",
  ".env.local",
  "a+b.ts",
  "aab.ts",
  "(x)/[y].ts",
  "x/y.ts",
];
const UNRECOGNIZED = ["a**b", "x/**b", "a{b", "a}b", "{a,{b,c}}"];

test("el matcher del worker y el de core casan igual", () => {
  for (const glob of GLOBS) {
    const core = compileGlobs([glob]);
    assert.ok(core, glob);
    const worker = globMatcher([glob]);
    for (const path of PATHS) assert.equal(worker(path), core(path), `${glob} con ${path}`);
  }
});

test("un glob que no reconoce uno tampoco lo reconoce el otro", () => {
  for (const glob of UNRECOGNIZED) {
    assert.equal(compileGlobs([glob]), null, glob);
    const worker = globMatcher([glob]);
    for (const path of PATHS) assert.equal(worker(path), true, `${glob} con ${path}`);
  }
});
