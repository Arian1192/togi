import assert from "node:assert/strict";
import { test } from "node:test";
import { protectedPathsOf, type RepoProfile } from "@togi/core";
import { globMatcher } from "./glob.ts";

const profile: RepoProfile = {
  install: "pnpm install --frozen-lockfile",
  checks: { typecheck: "pnpm typecheck", lint: null, test: "pnpm test" },
  testFiles: ["**/*.test.ts"],
  protectedPaths: [],
  docs: [],
  registry: [],
  testExclude: [],
};

test("los mínimos de core, por el matcher del worker, bloquean lo que trucaría los gates", () => {
  const isProtected = globMatcher(protectedPathsOf(profile));
  for (const path of [
    "package.json",
    "packages/api/package.json",
    "pnpm-lock.yaml",
    "tsconfig.base.json",
    "biome.json",
    "vitest.config.ts",
    ".github/workflows/ci.yml",
    ".env.local",
    ".ssh/k.pem",
    "certs/a.key",
  ]) {
    assert.equal(isProtected(path), true, path);
  }
  assert.equal(isProtected("packages/api/src/index.ts"), false);
});
