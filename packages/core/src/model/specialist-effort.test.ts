import assert from "node:assert/strict";
import { test } from "node:test";
import { EFFORTS, SpecialistSchema } from "./specialist.ts";

const builder = {
  id: "some-builder",
  version: 1,
  role: "builder",
  runtime: "claude-agent-sdk",
  model: "claude-sonnet-5-5",
  tools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
  instructions: "Construye.",
};

test("effort es opcional: un especialista sin él sigue siendo válido", () => {
  assert.ok(SpecialistSchema.safeParse(builder).success);
});

test("effort acepta los cinco valores del Agent SDK y rechaza cualquier otro", () => {
  assert.deepEqual(EFFORTS, ["low", "medium", "high", "xhigh", "max"]);
  for (const effort of EFFORTS) {
    assert.ok(SpecialistSchema.safeParse({ ...builder, effort }).success, effort);
  }
  for (const effort of ["", "minimal", "MEDIUM", 3]) {
    assert.ok(!SpecialistSchema.safeParse({ ...builder, effort }).success, String(effort));
  }
});

test("un builder con las herramientas de ADR-003 pasa", () => {
  assert.ok(SpecialistSchema.safeParse({ ...builder, effort: "medium" }).success);
});

test("un builder con WebFetch se rechaza", () => {
  const result = SpecialistSchema.safeParse({ ...builder, tools: [...builder.tools, "WebFetch"] });
  assert.ok(!result.success);
  assert.match(result.error.message, /WebFetch/);
});
