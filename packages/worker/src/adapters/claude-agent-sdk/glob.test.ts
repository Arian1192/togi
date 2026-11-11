import assert from "node:assert/strict";
import { test } from "node:test";
import { globMatcher } from "./glob.ts";

const matches = (glob: string, path: string) => globMatcher([glob])(path);

test("** casa con cero o más segmentos; * y ? no cruzan /", () => {
  assert.equal(matches("**/a.ts", "a.ts"), true);
  assert.equal(matches("**/a.ts", "x/y/a.ts"), true);
  assert.equal(matches("x/**", "x/y/z.ts"), true);
  assert.equal(matches("x/**/z.ts", "x/z.ts"), true);
  assert.equal(matches("x/**/z.ts", "x/a/b/z.ts"), true);
  assert.equal(matches("*.ts", "a.ts"), true);
  assert.equal(matches("*.ts", "x/a.ts"), false);
  assert.equal(matches("?.ts", "a.ts"), true);
  assert.equal(matches("?.ts", "ab.ts"), false);
  assert.equal(matches("x?y", "x/y"), false);
});

test("las llaves dan alternativas", () => {
  assert.equal(matches("a.{ts,tsx}", "a.ts"), true);
  assert.equal(matches("a.{ts,tsx}", "a.tsx"), true);
  assert.equal(matches("a.{ts,tsx}", "a.js"), false);
});

test("los nombres con punto casan y no se distinguen mayúsculas", () => {
  assert.equal(matches("**/*.json", ".config/.hidden.json"), true);
  assert.equal(matches("x/**", "x/.git/config"), true);
  assert.equal(matches("**/package.json", "Package.JSON"), true);
  assert.equal(matches(".github/**", ".GitHub/workflows/ci.yml"), true);
});

test("los metacaracteres de regex se toman como literales", () => {
  assert.equal(matches("a+b.ts", "a+b.ts"), true);
  assert.equal(matches("a+b.ts", "aab.ts"), false);
  assert.equal(matches("a.ts", "abts"), false);
  assert.equal(matches("[ab].ts", "[ab].ts"), true);
  assert.equal(matches("[ab].ts", "a.ts"), false);
  assert.equal(matches("(x|y)$", "(x|y)$"), true);
});

test("lo que no reconoce cuenta como protegido", () => {
  for (const glob of ["a{b", "a}b", "{a,{b,c}}", "a**b", "**b", "a/**b"]) {
    assert.equal(globMatcher([glob])("cualquier/cosa.ts"), true, glob);
  }
  assert.equal(globMatcher([])("a.ts"), false);
  assert.equal(matches(".github/**", ".github/workflows/a\nb.yml"), true);
});

test("los globs del perfil de promos casan con lo esperado", () => {
  const tests = globMatcher(["apps/**/*.test.{ts,tsx}", "apps/web/e2e/**"]);
  assert.equal(tests("apps/api/src/promos.test.ts"), true);
  assert.equal(tests("apps/web/src/ui/Card.test.tsx"), true);
  assert.equal(tests("apps/web/e2e/login.spec.ts"), true);
  assert.equal(tests("apps/api/src/promos.ts"), false);
  assert.equal(tests("packages/x/a.test.ts"), false);
  const protectedPaths = globMatcher([
    "apps/*/src/test/**",
    "apps/api/drizzle/**",
    "**/vitest.config.ts",
    "**/playwright.config.ts",
    "apps/api/drizzle.config.ts",
    "bruno/**/.env*",
    "package-lock.json",
  ]);
  assert.equal(protectedPaths("apps/api/src/test/setup.ts"), true);
  assert.equal(protectedPaths("apps/api/drizzle/0001_init.sql"), true);
  assert.equal(protectedPaths("apps/web/vitest.config.ts"), true);
  assert.equal(protectedPaths("apps/api/drizzle.config.ts"), true);
  assert.equal(protectedPaths("bruno/env/.env.local"), true);
  assert.equal(protectedPaths("package-lock.json"), true);
  assert.equal(protectedPaths("apps/api/src/promos.ts"), false);
  assert.equal(protectedPaths("apps/api/src/sub/test/x.ts"), false);
});
