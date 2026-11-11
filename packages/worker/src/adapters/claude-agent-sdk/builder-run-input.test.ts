import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBuilderRun } from "./builder-run.ts";

const FULL = {
  prompt: "p",
  cwd: "/w/tree",
  model: "m",
  effort: "medium",
  maxTurns: 30,
  maxBudgetUsd: 2,
  executable: "/bin/claude",
  policy: {
    checks: { typecheck: "pnpm typecheck", lint: null, test: "pnpm test" },
    planFiles: ["src/a.ts"],
    existingTests: ["src/a.test.ts"],
    protectedPaths: ["package.json"],
  },
};

const without = (key: string) =>
  Object.fromEntries(Object.entries(FULL).filter(([k]) => k !== key));
const withPolicy = (policy: object) => ({ ...FULL, policy: { ...FULL.policy, ...policy } });

test("acepta una entrada completa, y sin ejecutable", () => {
  assert.deepEqual(parseBuilderRun(FULL), FULL);
  assert.deepEqual(parseBuilderRun(without("executable")), without("executable"));
});

test("rechaza la que no trae policy, ni un objeto", () => {
  assert.equal(parseBuilderRun(without("policy")), null);
  assert.equal(parseBuilderRun({ ...FULL, policy: "x" }), null);
  assert.equal(parseBuilderRun(null), null);
  assert.equal(parseBuilderRun("{}"), null);
});

test("rechaza planFiles o existingTests que no son listas de texto", () => {
  assert.equal(parseBuilderRun(withPolicy({ planFiles: "src/a.ts" })), null);
  assert.equal(parseBuilderRun(withPolicy({ planFiles: [1] })), null);
  assert.equal(parseBuilderRun(withPolicy({ existingTests: [null] })), null);
  assert.equal(parseBuilderRun(withPolicy({ protectedPaths: undefined })), null);
});

test("rechaza checks con valores que no son texto ni null", () => {
  assert.equal(parseBuilderRun(withPolicy({ checks: { test: 1 } })), null);
  assert.equal(parseBuilderRun(withPolicy({ checks: ["pnpm test"] })), null);
  assert.equal(parseBuilderRun(withPolicy({ checks: null })), null);
});

test("rechaza un cwd relativo y un effort fuera de la lista", () => {
  assert.equal(parseBuilderRun({ ...FULL, cwd: "tree" }), null);
  assert.equal(parseBuilderRun({ ...FULL, effort: "turbo" }), null);
  assert.equal(parseBuilderRun(without("effort")), null);
});

test("rechaza topes que no son números positivos y textos vacíos", () => {
  assert.equal(parseBuilderRun({ ...FULL, maxTurns: 0 }), null);
  assert.equal(parseBuilderRun({ ...FULL, maxTurns: 1.5 }), null);
  assert.equal(parseBuilderRun({ ...FULL, maxBudgetUsd: "2" }), null);
  assert.equal(parseBuilderRun({ ...FULL, prompt: "" }), null);
  assert.equal(parseBuilderRun({ ...FULL, executable: 3 }), null);
});

test("una root en la entrada no entra en la política: se descarta", () => {
  const run = parseBuilderRun(withPolicy({ root: "/" }));
  assert.ok(run);
  assert.equal("root" in run.policy, false);
});
