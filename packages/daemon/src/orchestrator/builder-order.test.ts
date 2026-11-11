import assert from "node:assert/strict";
import { relative } from "node:path";
import { test } from "node:test";
import { PROTECTED_PATH_MINIMUMS } from "@togi/core";
import { PROMOS_PROFILE as PROFILE } from "../../../core/src/testing/promos-profile.ts";
import { parseBuilderRun } from "../../../worker/src/adapters/claude-agent-sdk/builder-run.ts";
import { claudeAgentSdkDeclaration } from "../../../worker/src/adapters/claude-agent-sdk/declaration.ts";
import { type BuilderRequest, builderOrder } from "./builder-order.ts";

const request = (mode: "api-key" | "subscription" = "api-key"): BuilderRequest => ({
  paths: { tree: "/h/.togi/workspaces/wsp_1/tree", gitDir: "/h/.togi/workspaces/wsp_1/git" },
  profile: PROFILE,
  planFiles: ["src/a.ts"],
  existingTests: ["src/a.test.ts"],
  prompt: "construye",
  model: "claude-sonnet-5-5",
  effort: "medium",
  maxTurns: 30,
  maxBudgetUsd: 2,
  executable: "/bin/claude",
  declaration: claudeAgentSdkDeclaration(mode),
  builderEntry: "/w/builder-main.ts",
  runtimePaths: ["/node"],
  credential: { name: "ANTHROPIC_API_KEY", secret: "s" },
  timeoutMs: 60_000,
});

test("la red es solo la de la declaración, aunque el perfil traiga registry", () => {
  const order = builderOrder(request(), "ses_1");
  assert.deepEqual(order.spec.allowedDomains, ["api.anthropic.com"]);
});

test("sin bloqueos de pnpm, sobre el árbol, con writeDir fuera de él", () => {
  const { spec, workspacesRoot, argv } = builderOrder(request(), "ses_1");
  assert.equal(spec.pnpmLocks, undefined);
  assert.equal(spec.workTree, "/h/.togi/workspaces/wsp_1/tree");
  assert.deepEqual(spec.readPaths, []);
  assert.ok(relative(spec.workTree, spec.writeDir).startsWith(".."));
  assert.ok(!relative(workspacesRoot, spec.writeDir).startsWith(".."));
  assert.deepEqual(argv, [process.execPath, "/w/builder-main.ts"]);
});

test("la entrada pasa parseBuilderRun, con cwd igual al árbol y los mínimos protegidos", () => {
  const order = builderOrder(request(), "ses_1");
  const run = parseBuilderRun(JSON.parse(order.input ?? ""));
  assert.ok(run);
  assert.equal(run.cwd, order.spec.workTree);
  assert.equal(run.maxTurns, 30);
  assert.deepEqual(run.policy.checks, PROFILE.checks);
  assert.deepEqual(run.policy.planFiles, ["src/a.ts"]);
  assert.deepEqual(run.policy.existingTests, ["src/a.test.ts"]);
  for (const glob of [...PROTECTED_PATH_MINIMUMS, ...PROFILE.protectedPaths])
    assert.ok(run.policy.protectedPaths.includes(glob), glob);
});

test("en modo clave de API la credencial va oculta con su marcador", () => {
  const order = builderOrder(request(), "ses_1");
  assert.deepEqual(order.spec.credentials, [
    { name: "ANTHROPIC_API_KEY", injectDomains: ["api.anthropic.com"] },
  ]);
  assert.ok(order.spec.allowedEnv.includes("ANTHROPIC_API_KEY"));
  assert.deepEqual(order.credential, { name: "ANTHROPIC_API_KEY", secret: "s" });
});

test("en modo suscripción el token va en claro, sin marcador", () => {
  const order = builderOrder(request("subscription"), "ses_1");
  assert.deepEqual(order.spec.credentials, []);
  assert.ok(order.spec.allowedEnv.includes("CLAUDE_CODE_OAUTH_TOKEN"));
});
