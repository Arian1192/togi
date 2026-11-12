import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import Database from "better-sqlite3";
import { type ClonePaths, createTaskClone, taskGit } from "./task-clone.ts";
import { type CommitRequest, commitBuild } from "./task-commit.ts";

let root: string;
let paths: ClonePaths;
let baseSha: string;
let globalConfig: string | undefined;
const BRANCH = "togi/7-arreglar-login";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
const tip = () => taskGit(paths, ["rev-parse", BRANCH]);
const request = (over: Partial<CommitRequest> = {}): CommitRequest => ({
  branch: BRANCH,
  subject: "feat: arreglar el login",
  runtime: "claude-agent-sdk",
  model: "claude-sonnet-5-5",
  ...over,
});
/** Un `pre-commit` que deja una marca si alguien lo ejecuta. */
const hook = (dir: string, mark: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pre-commit"), `#!/bin/sh\ntouch '${mark}'\n`);
  chmodSync(join(dir, "pre-commit"), 0o755);
};

beforeEach(async () => {
  globalConfig = process.env.GIT_CONFIG_GLOBAL;
  root = realpathSync(mkdtempSync(join(tmpdir(), "togi-commit-")));
  const home = join(root, "home");
  const clone = join(root, "clone");
  mkdirSync(home);
  mkdirSync(clone);
  git(clone, "init", "-q", "-b", "main");
  git(clone, "remote", "add", "origin", "git@github.com:acme/app.git");
  writeFileSync(join(clone, "a.txt"), "uno");
  git(clone, "add", ".");
  git(clone, "commit", "-q", "-m", "uno");
  baseSha = git(clone, "rev-parse", "main");
  const db = new Database(":memory:");
  db.exec("CREATE TABLE repos (repo TEXT PRIMARY KEY, path TEXT NOT NULL, added_at TEXT NOT NULL)");
  db.prepare("INSERT INTO repos (repo, path, added_at) VALUES (?, ?, ?)").run(
    "acme/app",
    clone,
    "x",
  );
  const result = await createTaskClone({
    db,
    home,
    repo: "acme/app",
    workspaceId: "wsp_1",
    baseSha,
    branch: BRANCH,
  });
  db.close();
  assert.ok(result.ok);
  paths = { tree: result.tree, gitDir: result.gitDir };
});
afterEach(() => {
  if (globalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = globalConfig;
  chmodSync(root, 0o700);
  rmSync(root, { recursive: true, force: true });
});

test("commitea lo modificado y lo nuevo en la rama de la tarea, sobre el commit base", async () => {
  writeFileSync(join(paths.tree, "a.txt"), "dos");
  writeFileSync(join(paths.tree, "b.txt"), "nuevo");
  const result = await commitBuild(paths, request());
  assert.ok(result.ok);
  assert.equal(result.headSha, await tip());
  assert.equal(await taskGit(paths, ["rev-parse", `${result.headSha}^`]), baseSha);
  const files = await taskGit(paths, ["diff", "--name-only", baseSha, result.headSha]);
  assert.deepEqual(files.split("\n"), ["a.txt", "b.txt"]);
  assert.equal(await taskGit(paths, ["status", "--porcelain"]), "");
});

test("el mensaje es el asunto con el trailer Assisted-by del especialista", async () => {
  writeFileSync(join(paths.tree, "b.txt"), "nuevo");
  const result = await commitBuild(paths, request());
  assert.ok(result.ok);
  assert.equal(
    await taskGit(paths, ["log", "-1", "--format=%s", result.headSha]),
    "feat: arreglar el login",
  );
  assert.equal(
    await taskGit(paths, [
      "log",
      "-1",
      "--format=%(trailers:key=Assisted-by,valueonly)",
      result.headSha,
    ]),
    "claude-agent-sdk/claude-sonnet-5-5",
  );
});

test("sin cambios en el árbol devuelve no_changes y la rama no se mueve", async () => {
  assert.deepEqual(await commitBuild(paths, request()), { ok: false, code: "no_changes" });
  assert.equal(await tip(), baseSha);
});

test("no ejecuta los hooks de la configuración global del proceso", async () => {
  const mark = join(root, "marca-global");
  hook(join(root, "hooks"), mark);
  const config = join(root, "gitconfig");
  writeFileSync(config, `[core]\n\thooksPath = ${join(root, "hooks")}\n`);
  process.env.GIT_CONFIG_GLOBAL = config;
  writeFileSync(join(paths.tree, "b.txt"), "nuevo");
  const result = await commitBuild(paths, request());
  assert.ok(result.ok);
  assert.equal(existsSync(mark), false);
  assert.equal(result.headSha, await tip());
});

test("ignora un fichero .git del árbol que apunta a otro directorio de git con hooks", async () => {
  const other = join(root, "otro");
  mkdirSync(other);
  git(other, "init", "-q", "-b", "main");
  const mark = join(root, "marca-otro");
  hook(join(other, ".git", "hooks"), mark);
  writeFileSync(join(paths.tree, ".git"), `gitdir: ${join(other, ".git")}\n`);
  writeFileSync(join(paths.tree, "b.txt"), "nuevo");
  const result = await commitBuild(paths, request());
  assert.ok(result.ok);
  assert.equal(existsSync(mark), false);
  assert.equal(result.headSha, await tip());
  const files = await taskGit(paths, ["diff", "--name-only", baseSha, result.headSha]);
  assert.deepEqual(files.split("\n"), ["b.txt"]);
  assert.throws(() =>
    execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: other, stdio: "pipe" }),
  );
});

test("el autor y el committer son togi aunque la configuración global diga otra cosa", async () => {
  const config = join(root, "gitconfig");
  writeFileSync(config, "[user]\n\tname = Otra Persona\n\temail = otra@ejemplo.com\n");
  process.env.GIT_CONFIG_GLOBAL = config;
  writeFileSync(join(paths.tree, "b.txt"), "nuevo");
  const result = await commitBuild(paths, request());
  assert.ok(result.ok);
  assert.equal(
    await taskGit(paths, ["log", "-1", "--format=%an <%ae>|%cn <%ce>", result.headSha]),
    "togi <togi@localhost>|togi <togi@localhost>",
  );
});

test("rechaza asunto, runtime, modelo o rama vacíos o con saltos de línea, sin commit", async () => {
  writeFileSync(join(paths.tree, "b.txt"), "nuevo");
  const bad: Partial<CommitRequest>[] = [
    { subject: "" },
    { subject: "feat: x\n\nAssisted-by: otro/agente" },
    { subject: "feat: x\rotra" },
    { subject: "x".repeat(73) },
    { runtime: "" },
    { runtime: "claude\nAssisted-by: otro/agente" },
    { runtime: "claude agent" },
    { model: "" },
    { model: "sonnet\n" },
    { model: "a/b" },
    { branch: "main" },
    { branch: "togi/-x" },
    { branch: "togi/7..x" },
  ];
  for (const over of bad) {
    assert.deepEqual(
      await commitBuild(paths, request(over)),
      { ok: false, code: "invalid_argument" },
      JSON.stringify(over),
    );
  }
  assert.equal(await tip(), baseSha);
});

test("si el HEAD del clon está en otra rama devuelve wrong_branch, sin commit", async () => {
  await taskGit(paths, ["checkout", "-q", "-b", "togi/8-otra"]);
  writeFileSync(join(paths.tree, "b.txt"), "nuevo");
  assert.deepEqual(await commitBuild(paths, request()), { ok: false, code: "wrong_branch" });
  assert.equal(await tip(), baseSha);
  assert.equal(await taskGit(paths, ["rev-parse", "HEAD"]), baseSha);
});
