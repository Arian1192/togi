import assert from "node:assert/strict";
import { test } from "node:test";
import { type BuilderPolicy, decideBuilderTool } from "./builder-policy.ts";

const policy: BuilderPolicy = {
  root: "/repo",
  checks: { typecheck: "pnpm typecheck", lint: null, test: "pnpm test" },
  planFiles: [
    "apps/api/src/promos.ts",
    "apps/api/src/new.ts",
    "apps/api/src/new.test.ts",
    "package.json",
  ],
  existingTests: ["apps/api/src/old.test.ts"],
  protectedPaths: ["**/package.json", ".github/**"],
};

const decide = (tool: string, file_path: unknown) =>
  decideBuilderTool(policy, { tool_name: tool, tool_input: { file_path } }).decision;

test("se permiten los ficheros del plan y los tests nuevos, en ruta relativa o absoluta", () => {
  for (const tool of ["Edit", "Write"]) {
    assert.equal(decide(tool, "/repo/apps/api/src/promos.ts"), "allow");
    assert.equal(decide(tool, "apps/api/src/new.ts"), "allow");
    assert.equal(decide(tool, "/repo/apps/api/src/new.test.ts"), "allow");
    assert.equal(decide(tool, "/repo/apps/api/./src/promos.ts"), "allow");
  }
});

test("se rechaza lo que está fuera del plan", () => {
  for (const tool of ["Edit", "Write"]) {
    assert.equal(decide(tool, "/repo/apps/api/src/other.ts"), "deny");
    assert.equal(decide(tool, "/repo/README.md"), "deny");
  }
});

test("se rechazan los tests existentes y las rutas protegidas, aunque el plan las liste", () => {
  for (const tool of ["Edit", "Write"]) {
    assert.equal(decide(tool, "/repo/apps/api/src/old.test.ts"), "deny");
    assert.equal(decide(tool, "/repo/apps/api/src/OLD.test.ts"), "deny");
    assert.equal(decide(tool, "/repo/package.json"), "deny");
    assert.equal(decide(tool, "/repo/.github/workflows/ci.yml"), "deny");
  }
  const listed = { ...policy, planFiles: [...policy.planFiles, "apps/api/src/old.test.ts"] };
  const edit = { tool_name: "Edit", tool_input: { file_path: "/repo/apps/api/src/old.test.ts" } };
  assert.equal(decideBuilderTool(listed, edit).decision, "deny");
});

test("se rechazan las variantes de mayúsculas, lo que sale de root, los .. y la falta de file_path", () => {
  for (const tool of ["Edit", "Write"]) {
    assert.equal(decide(tool, "/repo/Apps/api/src/promos.ts"), "deny");
    assert.equal(decide(tool, "/repo/apps/api/src/Promos.ts"), "deny");
    assert.equal(decide(tool, "/otro/apps/api/src/promos.ts"), "deny");
    assert.equal(decide(tool, "/repo"), "deny");
    assert.equal(decide(tool, "/repo/apps/x/../api/src/promos.ts"), "deny");
    assert.equal(decide(tool, "../repo/apps/api/src/promos.ts"), "deny");
    assert.equal(decide(tool, undefined), "deny");
    assert.equal(decide(tool, ""), "deny");
  }
  assert.equal(decideBuilderTool(policy, { tool_name: "Edit" }).decision, "deny");
});

test("cada rechazo lleva su motivo", () => {
  const denied = decideBuilderTool(policy, {
    tool_name: "Write",
    tool_input: { file_path: "/repo/README.md" },
  });
  assert.equal(denied.decision, "deny");
  assert.ok(denied.decision === "deny" && denied.reason.length > 0);
});
