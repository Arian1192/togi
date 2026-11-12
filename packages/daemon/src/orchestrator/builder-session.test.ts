import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { genericBuilder, type StoredEvent, specialistHash } from "@togi/core";
import { PROMOS_PROFILE } from "../../../core/src/testing/promos-profile.ts";
import { claudeAgentSdkDeclaration } from "../../../worker/src/adapters/claude-agent-sdk/declaration.ts";
import { taskGit } from "../workspaces/task-clone.ts";
import { runBuildSession } from "./builder-session.ts";
import { type BuildFixture, buildFixture, fakeLauncher } from "./testing/build-session-fixture.ts";

let f: BuildFixture;
const payload = (e: StoredEvent | undefined) => e?.payload as Record<string, unknown>;
const head = () => taskGit(f.input.workspace, ["rev-parse", "HEAD"]);

beforeEach(async () => {
  f = await buildFixture();
});
afterEach(() => f.close());

test("una sesión completed con cambios: sesión del builder, commit de togi y build.submitted", async () => {
  const result = await runBuildSession(f.deps(fakeLauncher()), f.input);
  const [started, ended, submitted, ...rest] = await f.events();
  assert.deepEqual(rest, []);
  assert.equal(started?.type, "session.started");
  const s = payload(started);
  assert.equal(s.role, "builder");
  assert.equal(s.cycle, 1);
  assert.equal(s.workspaceId, f.input.workspace.workspaceId);
  assert.equal(s.model, "claude-sonnet-5-5");
  assert.deepEqual(s.specialist, {
    id: "generic-builder",
    version: 1,
    hash: specialistHash(genericBuilder),
  });
  const policy = JSON.parse(await f.handle.readText(s.policy as never));
  assert.equal(policy.maxTurns, 30);
  assert.equal(policy.credentialMode, "api-key");
  assert.equal(ended?.type, "session.ended");
  assert.equal(payload(ended).outcome, "completed");
  const sha = await head();
  assert.notEqual(sha, f.input.workspace.baseSha);
  const message = await taskGit(f.input.workspace, ["log", "-1", "--format=%B"]);
  assert.match(message, /^togi\(1\): ciclo 1\n/);
  assert.match(message, /Assisted-by: claude-agent-sdk\/claude-sonnet-5-5/);
  assert.equal(submitted?.type, "build.submitted");
  assert.deepEqual(payload(submitted), { cycle: 1, headSha: sha });
  assert.deepEqual(result, { kind: "submitted", headSha: sha });
});

test("una sesión completed sin cambios entrega el HEAD del clon, que en el ciclo 1 es baseSha", async () => {
  const result = await runBuildSession(f.deps(fakeLauncher([{ write: false }])), f.input);
  const submitted = (await f.events()).find((e) => e.type === "build.submitted");
  const { baseSha } = f.input.workspace;
  assert.deepEqual(payload(submitted), { cycle: 1, headSha: baseSha });
  assert.deepEqual(result, { kind: "submitted", headSha: baseSha });
});

test("una sesión que agota el tiempo se cierra failed con timeout y aun así se entrega", async (t) => {
  t.mock.method(console, "error", () => {});
  const launcher = fakeLauncher([{ outcome: "timeout", failureReason: "timeout" }]);
  const result = await runBuildSession(f.deps(launcher), f.input);
  const all = await f.events();
  const ended = payload(all.find((e) => e.type === "session.ended"));
  assert.equal(ended.outcome, "failed");
  assert.equal(ended.failureReason, "timeout");
  const sha = await head();
  assert.notEqual(sha, f.input.workspace.baseSha);
  const submitted = payload(all.find((e) => e.type === "build.submitted"));
  assert.deepEqual(submitted, { cycle: 1, headSha: sha });
  assert.deepEqual(result, { kind: "submitted", headSha: sha });
});

test("la orden del launcher: el árbol del clon, la red de la declaración y los topes de la entrada", async () => {
  const launcher = fakeLauncher();
  await runBuildSession(f.deps(launcher), f.input);
  const [order] = launcher.orders;
  assert.ok(order);
  assert.equal(order.spec.workTree, f.input.workspace.tree);
  assert.deepEqual(order.spec.readPaths, []);
  assert.deepEqual(order.spec.allowedDomains, claudeAgentSdkDeclaration("api-key").domains);
  assert.ok(!order.spec.allowedDomains.some((d) => PROMOS_PROFILE.registry.includes(d)));
  const run = JSON.parse(order.input ?? "");
  assert.equal(run.maxTurns, 30);
  assert.equal(run.effort, "medium");
  assert.equal(run.maxBudgetUsd, 2);
});
