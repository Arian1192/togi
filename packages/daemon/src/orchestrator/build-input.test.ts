import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { type Actor, type RepoProfile, repoStream, setRepoProfile } from "@togi/core";
import { PROMOS_PROFILE } from "../../../core/src/testing/promos-profile.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import type { InstallRequest, InstallResult } from "../workspaces/install-runner.ts";
import { taskGit } from "../workspaces/task-clone.ts";
import { createTaskWorkspaces } from "../workspaces/task-workspace.ts";
import { type PrepareBuildDeps, planFilesOf, prepareBuild } from "./build-input.ts";
import { runBuildSession } from "./builder-session.ts";
import { type BuildFixture, buildFixture, fakeLauncher } from "./testing/build-session-fixture.ts";

const human: Actor = { kind: "human", userId: "usr_1" };
let f: BuildFixture;
let store: SqliteEventStore;

beforeEach(async () => {
  f = await buildFixture();
  store = new SqliteEventStore(f.db);
});
afterEach(() => f.close());

const setProfile = async (profile: RepoProfile) => {
  const stream = repoStream("acme/app");
  let version = 0;
  for await (const e of store.readStream(stream)) version = e.streamVersion;
  const events = setRepoProfile(null, "acme/app", profile, human, "2026-11-13T00:00:00Z");
  assert.ok(Array.isArray(events));
  await store.append(stream, version, events);
};

const taskEvents = async () => {
  let count = 0;
  for await (const _ of store.readStream("task:1")) count++;
  return count;
};

/** Las dependencias con el clon real y un instalador falso que registra sus llamadas. */
function deps(install: InstallResult = { status: "ok", output: "" }) {
  const installs: InstallRequest[] = [];
  const prepared: number[] = [];
  const home = dirname(dirname(dirname(f.input.workspace.tree)));
  const real = createTaskWorkspaces({ db: f.db, store, handle: f.handle, home });
  const d: PrepareBuildDeps = {
    store,
    readText: f.handle.readText,
    workspaces: {
      prepareWorkspace: (n) => {
        prepared.push(n);
        return real.prepareWorkspace(n);
      },
    },
    install: {
      run: async (request) => {
        installs.push(request);
        return install;
      },
    },
    installTimeoutMs: 1000,
    runtimePaths: ["/node"],
    instructions: "instrucciones del builder",
  };
  return { d, installs, prepared };
}

test("camino feliz: el clon, el perfil, los ficheros del plan y el prompt; instala una vez", async () => {
  await setProfile(PROMOS_PROFILE);
  const { d, installs } = deps();
  const result = await prepareBuild(d, 1);
  assert.ok(result.ok);
  const { input } = result;
  assert.equal(input.number, 1);
  assert.equal(input.cycle, 1);
  assert.equal(input.workspace.tree, f.input.workspace.tree);
  assert.equal(input.workspace.workspaceId, f.input.workspace.workspaceId);
  assert.deepEqual(input.profile, PROMOS_PROFILE);
  assert.deepEqual(input.planFiles, ["b.txt"]);
  assert.deepEqual(input.existingTests, []);
  assert.match(input.prompt, /^instrucciones del builder/);
  assert.match(input.prompt, /Arreglar el login/);
  assert.match(input.prompt, /- add b\.txt/);
  assert.match(input.prompt, /- pnpm typecheck/);
  assert.match(input.prompt, /- pnpm test/);
  assert.match(input.prompt, /enfoque/);
  assert.equal(installs.length, 1);
  const [request] = installs;
  assert.equal(request?.paths.tree, f.input.workspace.tree);
  assert.equal(request?.profile.install, PROMOS_PROFILE.install);
  assert.deepEqual(request?.profile.registry, PROMOS_PROFILE.registry);
  assert.deepEqual(request?.runtimePaths, ["/node"]);
  assert.equal(request?.timeoutMs, 1000);
});

test("el perfil es el del log, el último repo.profile_set", async () => {
  await setProfile(PROMOS_PROFILE);
  const second = { ...PROMOS_PROFILE, install: "pnpm install" };
  await setProfile(second);
  const result = await prepareBuild(deps().d, 1);
  assert.ok(result.ok);
  assert.deepEqual(result.input.profile, second);
});

test("existingTests sale de baseSha: lo commiteado después en el clon no cuenta", async () => {
  await setProfile({ ...PROMOS_PROFILE, testFiles: ["*.txt"] });
  const ws = f.input.workspace;
  writeFileSync(join(ws.tree, "c.txt"), "tarde");
  await taskGit(ws, ["add", "c.txt"]);
  await taskGit(ws, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "c"]);
  const result = await prepareBuild(deps().d, 1);
  assert.ok(result.ok);
  assert.deepEqual(result.input.existingTests, ["a.txt"]);
});

test("con una sesión del builder ya abierta en el ciclo no se reinstala", async (t) => {
  t.mock.method(console, "error", () => {});
  await setProfile(PROMOS_PROFILE);
  const launcher = fakeLauncher([{ outcome: "failed", failureReason: "agent_failed" }]);
  assert.equal((await runBuildSession(f.deps(launcher), f.input)).kind, "paused");
  const { d, installs } = deps();
  const result = await prepareBuild(d, 1);
  assert.ok(result.ok);
  assert.equal(installs.length, 0);
});

for (const install of [
  { status: "failed", exitCode: 1, output: "ERR_PNPM" },
  { status: "timeout", output: "lento" },
] as const) {
  test(`una instalación ${install.status} da install_failed y no escribe eventos`, async () => {
    await setProfile(PROMOS_PROFILE);
    const before = await taskEvents();
    const result = await prepareBuild(deps(install).d, 1);
    assert.deepEqual(result, { ok: false, code: "install_failed", install });
    assert.equal(await taskEvents(), before);
  });
}

test("sin perfil da profile_missing sin preparar el clon", async () => {
  const before = await taskEvents();
  const { d, prepared, installs } = deps();
  assert.deepEqual(await prepareBuild(d, 1), { ok: false, code: "profile_missing" });
  assert.deepEqual(prepared, []);
  assert.equal(installs.length, 0);
  assert.equal(await taskEvents(), before);
});

test("una tarea que no existe o que no está en building", async () => {
  await setProfile(PROMOS_PROFILE);
  await f.handle(human, {
    type: "create",
    title: "Otra",
    description: "",
    acceptanceCriteria: "",
    risk: "low",
    repo: "acme/app",
    baseBranch: "main",
    source: { kind: "cli" },
  });
  const { d, prepared } = deps();
  assert.deepEqual(await prepareBuild(d, 99), { ok: false, code: "task_not_found" });
  assert.deepEqual(await prepareBuild(d, 2), { ok: false, code: "invalid_state" });
  assert.deepEqual(prepared, []);
});

test("planFilesOf: los add y modify más los tests nuevos, sin delete ni duplicados", () => {
  const files = planFilesOf({
    files: [
      { path: "a.ts", change: "add" },
      { path: "b.ts", change: "modify" },
      { path: "c.ts", change: "delete" },
      { path: "a.test.ts", change: "add" },
    ],
    newTests: ["a.test.ts", "d.test.ts"],
  });
  assert.deepEqual(files, ["a.ts", "b.ts", "a.test.ts", "d.test.ts"]);
});
