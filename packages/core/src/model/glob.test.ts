import assert from "node:assert/strict";
import { test } from "node:test";
import { compileGlobs } from "./glob.ts";

const matches = (globs: string[], path: string) => {
  const matcher = compileGlobs(globs);
  assert.ok(matcher, `los globs ${globs.join(", ")} deben reconocerse`);
  return matcher(path);
};

test("`**/` casa con cero o más carpetas; `*` y `?` no cruzan `/`", () => {
  assert.equal(matches(["**/a.ts"], "a.ts"), true);
  assert.equal(matches(["**/a.ts"], "x/y/a.ts"), true);
  assert.equal(matches(["src/**"], "src/x/y.ts"), true);
  assert.equal(matches(["src/*.ts"], "src/a.ts"), true);
  assert.equal(matches(["src/*.ts"], "src/x/a.ts"), false);
  assert.equal(matches(["src/?.ts"], "src/a.ts"), true);
  assert.equal(matches(["src/?.ts"], "src/ab.ts"), false);
  assert.equal(matches(["src?a.ts"], "src/a.ts"), false);
});

test("`{ts,tsx}` casa con los dos, como en el perfil de promos", () => {
  const globs = ["apps/**/*.test.{ts,tsx}"];
  assert.equal(matches(globs, "apps/api/src/x.test.ts"), true);
  assert.equal(matches(globs, "apps/web/src/y.test.tsx"), true);
  assert.equal(matches(globs, "apps/web/src/y.test.js"), false);
});

test("casa con nombres que empiezan por punto, sin distinguir mayúsculas", () => {
  assert.equal(matches(["**/.env*"], ".env.local"), true);
  assert.equal(matches(["**/*.ts"], "src/.hidden/a.ts"), true);
  assert.equal(matches(["src/*.ts"], "SRC/A.TS"), true);
});

test("los metacaracteres de regex son literales", () => {
  assert.equal(matches(["a.ts"], "aXts"), false);
  assert.equal(matches(["a+b.ts"], "a+b.ts"), true);
  assert.equal(matches(["a+b.ts"], "aab.ts"), false);
  assert.equal(matches(["(x)/[y].ts"], "(x)/[y].ts"), true);
  assert.equal(matches(["(x)/[y].ts"], "x/y.ts"), false);
});

test("un glob que no reconoce da null, aunque los demás sí se reconozcan", () => {
  for (const glob of ["a**b", "x/**b", "a{b", "a}b", "{a,{b,c}}"]) {
    assert.equal(compileGlobs(["src/**", glob]), null, glob);
  }
});

test("sin globs no casa nada", () => {
  const matcher = compileGlobs([]);
  assert.ok(matcher);
  assert.equal(matcher("a.ts"), false);
});
