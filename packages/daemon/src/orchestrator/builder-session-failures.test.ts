import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { taskGit } from "../workspaces/task-clone.ts";
import { runBuildSession } from "./builder-session.ts";
import { type BuildFixture, buildFixture, fakeLauncher } from "./testing/build-session-fixture.ts";

let f: BuildFixture;
const types = async () => (await f.events()).map((e) => e.type);
const failures = async () =>
  (await f.events())
    .filter((e) => e.type === "session.ended")
    .map((e) => (e.payload as { failureReason: string | null }).failureReason);
/** Sin commit, la punta de la rama sigue en el commit base. */
const head = () => taskGit(f.input.workspace, ["rev-parse", "HEAD"]);

beforeEach(async () => {
  f = await buildFixture();
});
afterEach(() => f.close());

test("agent_failed: una sola sesión, sin commit ni entrega, y la tarea sigue en building", async (t) => {
  t.mock.method(console, "error", () => {});
  const launcher = fakeLauncher([{ outcome: "failed", failureReason: "agent_failed" }]);
  const result = await runBuildSession(f.deps(launcher), f.input);
  assert.equal(launcher.orders.length, 1);
  assert.deepEqual(await types(), ["session.started", "session.ended"]);
  assert.deepEqual(await failures(), ["agent_failed"]);
  assert.equal(await head(), f.input.workspace.baseSha);
  assert.deepEqual(result, { kind: "paused", reason: "agent_failed" });
  const task = f.db.prepare("SELECT state FROM tasks WHERE number = 1").get();
  assert.deepEqual(task, { state: "building" });
});

test("sin credencial la sesión se abre y se cierra con credential_missing, sin lanzar nada", async () => {
  const launcher = fakeLauncher();
  const credentials = { read: async () => null };
  const result = await runBuildSession(f.deps(launcher, { credentials }), f.input);
  assert.equal(launcher.orders.length, 0);
  assert.deepEqual(await types(), ["session.started", "session.ended"]);
  assert.deepEqual(await failures(), ["credential_missing"]);
  assert.deepEqual(result, { kind: "paused", reason: "credential_missing" });
});

test("si el commit falla no hay build.submitted y queda una línea en el log", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const commit = async () => ({ ok: false, code: "commit_failed" }) as const;
  const result = await runBuildSession(f.deps(fakeLauncher(), { commit }), f.input);
  assert.deepEqual(await types(), ["session.started", "session.ended"]);
  assert.deepEqual(result, { kind: "commit_failed" });
  assert.equal(logged.mock.callCount(), 1);
  assert.match(String(logged.mock.calls[0]?.arguments[0]), /commit/);
});

test("si el decider rechaza startSession (stale_cycle) devuelve not_started sin lanzar nada", async () => {
  const launcher = fakeLauncher();
  const result = await runBuildSession(f.deps(launcher), { ...f.input, cycle: 2 });
  assert.equal(launcher.orders.length, 0);
  assert.deepEqual(await types(), []);
  assert.deepEqual(result, { kind: "not_started", code: "stale_cycle" });
});

for (const reason of ["worker_died", "trajectory_write_failed"] as const) {
  test(`${reason} y después completed: dos sesiones en el mismo ciclo y una entrega`, async (t) => {
    t.mock.method(console, "error", () => {});
    const launcher = fakeLauncher([{ outcome: "failed", failureReason: reason }, {}]);
    const result = await runBuildSession(f.deps(launcher), f.input);
    assert.equal(launcher.orders.length, 2);
    assert.deepEqual(await types(), [
      "session.started",
      "session.ended",
      "session.started",
      "session.ended",
      "build.submitted",
    ]);
    assert.deepEqual(await failures(), [reason, null]);
    const headSha = await head();
    assert.notEqual(headSha, f.input.workspace.baseSha);
    assert.deepEqual(result, { kind: "submitted", headSha });
  });
}

test("worker_died dos veces: ni tercera sesión, ni commit, ni entrega, y la tarea sigue en building", async (t) => {
  t.mock.method(console, "error", () => {});
  const died = { outcome: "failed", failureReason: "worker_died" } as const;
  const launcher = fakeLauncher([died, died, {}]);
  const result = await runBuildSession(f.deps(launcher), f.input);
  assert.equal(launcher.orders.length, 2);
  const sessions = ["session.started", "session.ended", "session.started", "session.ended"];
  assert.deepEqual(await types(), sessions);
  assert.deepEqual(await failures(), ["worker_died", "worker_died"]);
  assert.equal(await head(), f.input.workspace.baseSha);
  assert.deepEqual(result, { kind: "paused", reason: "worker_died" });
  const task = f.db.prepare("SELECT state FROM tasks WHERE number = 1").get();
  assert.deepEqual(task, { state: "building" });
});
