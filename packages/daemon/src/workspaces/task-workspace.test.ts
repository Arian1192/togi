import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { type Actor, decide as coreDecide, domainError } from "@togi/core";
import type Database from "better-sqlite3";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { createHandler } from "../commands/handle-command.ts";
import { paths } from "../config/app.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { removeTaskClone, taskGit } from "./task-clone.ts";
import { createTaskWorkspaces } from "./task-workspace.ts";

let root: string;
let home: string;
let repoPath: string;
let db: Database.Database;
let store: SqliteEventStore;
let handle: ReturnType<typeof createHandler>;
let blobs: FileBlobStore;
const human: Actor = { kind: "human", userId: "usr_1" };
const system: Actor = { kind: "system", component: "adapter:planner" };
const WSP = "wsp_1";
const usage = { inputTokens: 1, outputTokens: 2, estimatedCostUsd: 0.1, durationMs: 5 };

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
const dir = () => join(home, "workspaces", WSP);
const paths1 = () => ({ tree: join(dir(), "tree"), gitDir: join(dir(), "git") });
const workspaces = (h = handle) => createTaskWorkspaces({ db, store, handle: h, home });
const eventsOf = async (type: string) => {
  const found = [];
  for await (const e of store.readStream("task:1")) if (e.type === type) found.push(e);
  return found;
};

const session = (sessionId: `ses_${string}`, role: "planner" | "builder") => ({
  sessionId,
  role,
  cycle: role === "builder" ? 1 : null,
  runtime: { id: "fake", version: "1" },
  model: "m",
  specialist: { id: "generic-planner", version: 1, hash: "sha256:abc" as const },
  workspaceId: role === "builder" ? (WSP as `wsp_${string}`) : null,
  prompt: "prompt",
  policy: "política",
});

/** La tarea 1, de `acme/app`, con su plan aprobado sobre la punta de `main`. */
async function toBuilding() {
  await handle(system, { type: "startSession", number: 1, session: session("ses_1", "planner") });
  await handle(
    { kind: "agent", sessionId: "ses_1", role: "planner" },
    {
      type: "proposePlan",
      number: 1,
      plan: {
        files: [{ path: "a.txt", change: "modify" }],
        newTests: [],
        approach: "enfoque",
        estimatedLines: { production: 1, tests: 0 },
        baseSha: git(repoPath, "rev-parse", "main"),
      },
    },
  );
  await handle(system, {
    type: "endSession",
    number: 1,
    session: { sessionId: "ses_1", outcome: "completed", usage, trajectoryEvents: 0 },
  });
  const approved = await handle(human, { type: "approvePlan", number: 1, planVersion: 1 });
  assert.ok("events" in approved);
}

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "togi-task-wsp-")));
  home = join(root, "home");
  repoPath = join(root, "repo");
  mkdirSync(home);
  mkdirSync(repoPath);
  git(repoPath, "init", "-q", "-b", "main");
  git(repoPath, "remote", "add", "origin", "git@github.com:acme/app.git");
  writeFileSync(join(repoPath, "a.txt"), "uno");
  git(repoPath, "add", ".");
  git(repoPath, "commit", "-q", "-m", "uno");
  const p = paths(home);
  db = openEventDatabase(p.database);
  db.prepare("INSERT INTO repos (repo, path, added_at) VALUES (?, ?, ?)").run(
    "acme/app",
    repoPath,
    "x",
  );
  const keys = new DataKeyring(
    db,
    await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } })),
  );
  store = new SqliteEventStore(db);
  blobs = new FileBlobStore(p.blobs, keys);
  handle = createHandler({ db, store, blobs });
  await handle(human, {
    type: "create",
    title: "Arreglar el login",
    description: "",
    acceptanceCriteria: "criterio",
    risk: "low",
    repo: "acme/app",
    baseBranch: "main",
    source: { kind: "cli" },
  });
  await handle(human, { type: "submit", number: 1 });
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

test("prepara el clon en el commit del plan aprobado y registra workspace.created una vez", async () => {
  await toBuilding();
  const { prepareWorkspace } = workspaces();
  const result = await prepareWorkspace(1);
  assert.ok(result.ok);
  const base = git(repoPath, "rev-parse", "main");
  assert.deepEqual(result.workspace, {
    workspaceId: WSP,
    kind: "clone",
    ref: dir(),
    branch: "togi/1-arreglar-el-login",
    baseSha: base,
  });
  assert.deepEqual({ tree: result.tree, gitDir: result.gitDir }, paths1());
  assert.equal(await taskGit(paths1(), ["rev-parse", "HEAD"]), base);
  const [created] = await eventsOf("workspace.created");
  assert.deepEqual(created?.payload, result.workspace);
  assert.deepEqual(created?.actor, { kind: "system", component: "adapter:builder" });

  const again = await prepareWorkspace(1);
  assert.ok(again.ok);
  assert.deepEqual(again.workspace, result.workspace);
  assert.equal((await eventsOf("workspace.created")).length, 1);
});

test("dos preparaciones a la vez dejan un solo clon y un solo evento", async () => {
  await toBuilding();
  const { prepareWorkspace } = workspaces();
  const [a, b] = await Promise.all([prepareWorkspace(1), prepareWorkspace(1)]);
  assert.ok(a.ok && b.ok);
  assert.equal((await eventsOf("workspace.created")).length, 1);
  assert.ok(existsSync(paths1().tree));
});

test("fuera de building no clona nada", async () => {
  const result = await workspaces().prepareWorkspace(1);
  assert.deepEqual(result, { ok: false, code: "invalid_state" });
  assert.equal(existsSync(dir()), false);
  assert.deepEqual(await workspaces().prepareWorkspace(99), { ok: false, code: "task_not_found" });
});

test("si el decider rechaza workspace.created, borra el clon", async () => {
  await toBuilding();
  const refusing = createHandler({
    db,
    store,
    blobs,
    decide: (view, cmd, policy) =>
      cmd.type === "createWorkspace"
        ? domainError("invalid_payload", "rechazado en el test")
        : coreDecide(view, cmd, policy),
  });
  const result = await workspaces(refusing).prepareWorkspace(1);
  assert.deepEqual(result, { ok: false, code: "invalid_payload" });
  assert.equal(existsSync(dir()), false);
  assert.equal((await eventsOf("workspace.created")).length, 0);
});

test("una carpeta sin evento (caída antes de registrar) se rehace desde cero", async () => {
  await toBuilding();
  mkdirSync(dir(), { recursive: true });
  writeFileSync(join(dir(), "a-medias"), "x");
  const result = await workspaces().prepareWorkspace(1);
  assert.ok(result.ok);
  assert.equal(existsSync(join(dir(), "a-medias")), false);
  assert.ok(existsSync(paths1().tree));
  assert.equal((await eventsOf("workspace.created")).length, 1);
});

test("un evento sin carpeta se rehace con sus datos si aún no se construyó nada", async () => {
  await toBuilding();
  const { prepareWorkspace } = workspaces();
  const first = await prepareWorkspace(1);
  assert.ok(first.ok);
  await removeTaskClone(home, WSP);
  const again = await prepareWorkspace(1);
  assert.ok(again.ok);
  assert.deepEqual(again.workspace, first.workspace);
  assert.equal(await taskGit(paths1(), ["rev-parse", "HEAD"]), first.workspace.baseSha);
  assert.equal((await eventsOf("workspace.created")).length, 1);
});

test("un evento sin carpeta tras una sesión del builder no se rehace: se avisa", async () => {
  await toBuilding();
  const { prepareWorkspace } = workspaces();
  assert.ok((await prepareWorkspace(1)).ok);
  const started = await handle(system, {
    type: "startSession",
    number: 1,
    session: session("ses_2", "builder"),
  });
  assert.ok("events" in started);
  await removeTaskClone(home, WSP);
  assert.deepEqual(await prepareWorkspace(1), { ok: false, code: "workspace_lost" });
  assert.equal(existsSync(dir()), false);
});

test("libera solo en un estado final: registra workspace.released y borra el clon", async () => {
  await toBuilding();
  const { prepareWorkspace, releaseTaskWorkspace } = workspaces();
  assert.ok((await prepareWorkspace(1)).ok);
  assert.deepEqual(await releaseTaskWorkspace(1), { ok: false, code: "invalid_state" });
  assert.ok(existsSync(paths1().tree));
  assert.equal((await eventsOf("workspace.released")).length, 0);

  await handle(human, { type: "completeTask", number: 1, prNumber: 7 });
  assert.deepEqual(await releaseTaskWorkspace(1), { ok: true });
  assert.equal(existsSync(dir()), false);
  const released = await eventsOf("workspace.released");
  assert.deepEqual(
    released.map((e) => e.payload),
    [{ workspaceId: WSP }],
  );
  assert.deepEqual(await releaseTaskWorkspace(1), { ok: true });
  assert.equal((await eventsOf("workspace.released")).length, 1);
  assert.deepEqual(await prepareWorkspace(1), { ok: false, code: "workspace_already_released" });
  assert.equal(existsSync(dir()), false);
});

test("en una tarea final no se rehace un clon que falta", async () => {
  await toBuilding();
  const { prepareWorkspace } = workspaces();
  assert.ok((await prepareWorkspace(1)).ok);
  await handle(human, { type: "completeTask", number: 1, prNumber: 7 });
  await removeTaskClone(home, WSP);
  assert.deepEqual(await prepareWorkspace(1), { ok: false, code: "workspace_lost" });
  assert.equal(existsSync(dir()), false);
});

test("con el evento ya escrito y la carpeta aún ahí (caída tras registrar), la borra", async () => {
  await toBuilding();
  const { prepareWorkspace, releaseTaskWorkspace } = workspaces();
  assert.ok((await prepareWorkspace(1)).ok);
  await handle(human, { type: "completeTask", number: 1, prNumber: 7 });
  const builder: Actor = { kind: "system", component: "adapter:builder" };
  const written = await handle(builder, {
    type: "releaseWorkspace",
    number: 1,
    workspaceId: WSP,
  });
  assert.ok("events" in written);
  assert.ok(existsSync(dir()));
  assert.deepEqual(await releaseTaskWorkspace(1), { ok: true });
  assert.equal(existsSync(dir()), false);
  assert.equal((await eventsOf("workspace.released")).length, 1);
});

test("una tarea final sin copia registrada no escribe nada, pero borra la carpeta huérfana", async () => {
  assert.deepEqual(await workspaces().releaseTaskWorkspace(1), {
    ok: false,
    code: "invalid_state",
  });
  mkdirSync(dir(), { recursive: true });
  await handle(human, {
    type: "reject",
    number: 1,
    category: "scope",
    text: "no toca",
  });
  assert.deepEqual(await workspaces().releaseTaskWorkspace(1), { ok: true });
  assert.equal(existsSync(dir()), false);
  assert.equal((await eventsOf("workspace.released")).length, 0);
  assert.deepEqual(await workspaces().releaseTaskWorkspace(99), {
    ok: false,
    code: "task_not_found",
  });
});
