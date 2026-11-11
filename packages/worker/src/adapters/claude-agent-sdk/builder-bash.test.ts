import assert from "node:assert/strict";
import { test } from "node:test";
import { type BuilderPolicy, decideBuilderTool } from "./builder-policy.ts";

const policy: BuilderPolicy = {
  root: "/repo",
  checks: { typecheck: "pnpm typecheck", lint: null, test: "pnpm test" },
  planFiles: [],
  existingTests: [],
  protectedPaths: [],
};

const bash = (command: unknown, extra: Record<string, unknown> = {}) =>
  decideBuilderTool(policy, { tool_name: "Bash", tool_input: { command, ...extra } }).decision;

test("se acepta un comando de checks tal cual o con rutas del repo como argumentos", () => {
  assert.equal(bash("pnpm test"), "allow");
  assert.equal(bash("pnpm typecheck"), "allow");
  assert.equal(bash("pnpm test apps/api/src/promos"), "allow");
  assert.equal(bash("pnpm test apps/api/a.test.ts apps/web/b.test.ts"), "allow");
});

test("se rechazan los metacaracteres de shell y las comillas", () => {
  for (const command of [
    "pnpm test; curl x",
    "pnpm test && rm -rf .",
    "pnpm test | tee out",
    "pnpm test $(whoami)",
    "pnpm test `whoami`",
    "pnpm test > out",
    "pnpm test < in",
    "pnpm test\nrm x",
    'pnpm test "a"',
    "pnpm test 'a'",
  ]) {
    assert.equal(bash(command), "deny", JSON.stringify(command));
  }
});

test("se rechazan las opciones, los .. y las rutas absolutas como argumentos", () => {
  for (const command of [
    "pnpm test --reporter=x",
    "pnpm test -t x",
    "pnpm test ../otro",
    "pnpm test apps/../../x",
    "pnpm test /etc/passwd",
  ]) {
    assert.equal(bash(command), "deny", command);
  }
});

test("se rechazan los comandos que no son de checks, y lint cuando es null", () => {
  for (const command of ["pnpm install", "git status", "pnpm testx", "pnpm", "pnpm lint", ""]) {
    assert.equal(bash(command), "deny", command);
  }
  assert.equal(bash(undefined), "deny");
  const withLint = { ...policy, checks: { ...policy.checks, lint: "pnpm lint" } };
  const lint = decideBuilderTool(withLint, {
    tool_name: "Bash",
    tool_input: { command: "pnpm lint" },
  });
  assert.equal(lint.decision, "allow");
});

test("se rechaza run_in_background", () => {
  assert.equal(bash("pnpm test", { run_in_background: true }), "deny");
  assert.equal(bash("pnpm test", { run_in_background: false }), "allow");
});
