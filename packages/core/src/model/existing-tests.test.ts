import assert from "node:assert/strict";
import { test } from "node:test";
import { PROMOS_PROFILE } from "../testing/promos-profile.ts";
import { existingTestsOf } from "./glob.ts";

const PATHS = [
  "apps/api/src/x.ts",
  "apps/api/src/x.test.ts",
  "apps/web/src/y.test.tsx",
  "apps/web/e2e/login.spec.ts",
  "apps/api/src/server.test.ts",
  "docs/a.md",
];

test("son las rutas que casan con testFiles", () => {
  const tests = existingTestsOf(PATHS, PROMOS_PROFILE);
  for (const path of ["apps/api/src/x.test.ts", "apps/web/src/y.test.tsx"]) {
    assert.ok(tests.includes(path), path);
  }
  assert.ok(tests.includes("apps/web/e2e/login.spec.ts"));
  assert.ok(!tests.includes("apps/api/src/x.ts"));
  assert.ok(!tests.includes("docs/a.md"));
});

test("incluye los tests de testExclude: siguen siendo tests existentes (ADR-001)", () => {
  assert.ok(PROMOS_PROFILE.testExclude.includes("apps/api/src/server.test.ts"));
  assert.ok(existingTestsOf(PATHS, PROMOS_PROFILE).includes("apps/api/src/server.test.ts"));
});

test("con un testFiles que no reconoce devuelve todas las rutas: falla en cerrado", () => {
  const profile = { ...PROMOS_PROFILE, testFiles: ["apps/**", "a**b"] };
  assert.deepEqual(existingTestsOf(PATHS, profile), PATHS);
});
