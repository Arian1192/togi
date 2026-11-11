import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import Database from "better-sqlite3";
import { createTaskClone, removeTaskClone, taskBranch, taskGit } from "./task-clone.ts";

let root: string;
let home: string;
let clone: string;
let db: Database.Database;
let globalConfig: string | undefined;
const WSP = "wsp_1";
const REMOTE = "git@github.com:acme/app.git";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
const head = () => git(clone, "rev-parse", "main");
const request = (over: Partial<Parameters<typeof createTaskClone>[0]> = {}) => ({
  db,
  home,
  repo: "acme/app",
  workspaceId: WSP as `wsp_${string}`,
  baseSha: head(),
  branch: "togi/7-arreglar-login",
  ...over,
});
const dir = () => join(home, "workspaces", WSP);

beforeEach(() => {
  globalConfig = process.env.GIT_CONFIG_GLOBAL;
  root = realpathSync(mkdtempSync(join(tmpdir(), "togi-clone-")));
  home = join(root, "home");
  clone = join(root, "clone");
  mkdirSync(home);
  mkdirSync(clone);
  git(clone, "init", "-q", "-b", "main");
  git(clone, "remote", "add", "origin", REMOTE);
  writeFileSync(join(clone, "a.txt"), "commiteado");
  git(clone, "add", ".");
  git(clone, "commit", "-q", "-m", "uno");
  db = new Database(":memory:");
  db.exec("CREATE TABLE repos (repo TEXT PRIMARY KEY, path TEXT NOT NULL, added_at TEXT NOT NULL)");
  db.prepare("INSERT INTO repos (repo, path, added_at) VALUES (?, ?, ?)").run(
    "acme/app",
    clone,
    "x",
  );
});
afterEach(() => {
  if (globalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = globalConfig;
  db.close();
  chmodSync(root, 0o700);
  rmSync(root, { recursive: true, force: true });
});

test("clon con el árbol y el directorio de git separados, en la rama de la tarea", async () => {
  writeFileSync(join(clone, "a.txt"), "sin commitear");
  const before = git(clone, "status", "--porcelain");
  const result = await createTaskClone(request());
  assert.ok(result.ok);
  assert.deepEqual(result.workspace, {
    workspaceId: WSP,
    kind: "clone",
    ref: dir(),
    branch: "togi/7-arreglar-login",
    baseSha: head(),
  });
  assert.equal(result.tree, join(dir(), "tree"));
  assert.equal(result.gitDir, join(dir(), "git"));
  assert.equal(readFileSync(join(result.tree, "a.txt"), "utf8"), "commiteado");
  assert.ok(existsSync(join(result.gitDir, "HEAD")));
  const gitIn = (...args: string[]) => taskGit(result, args);
  assert.equal(await gitIn("symbolic-ref", "HEAD"), "refs/heads/togi/7-arreglar-login");
  assert.equal(await gitIn("rev-parse", "HEAD"), head());
  assert.equal(await gitIn("status", "--porcelain"), "");
  assert.equal(git(clone, "status", "--porcelain"), before);
  assert.equal(git(clone, "branch", "--list", "togi/*"), "");
});

test("el commit base solo alcanzable por refs/remotes/origin del clon del usuario", async () => {
  git(clone, "checkout", "-q", "-b", "tmp");
  writeFileSync(join(clone, "b.txt"), "remoto");
  git(clone, "add", ".");
  git(clone, "commit", "-q", "-m", "remoto");
  const remote = git(clone, "rev-parse", "HEAD");
  git(clone, "update-ref", "refs/remotes/origin/main", remote);
  git(clone, "checkout", "-q", "main");
  git(clone, "branch", "-q", "-D", "tmp");
  const result = await createTaskClone(request({ baseSha: remote }));
  assert.ok(result.ok);
  assert.equal(readFileSync(join(result.tree, "b.txt"), "utf8"), "remoto");
});

test("no ejecuta hooks, plantillas ni filtros del repo ni de la configuración global", async () => {
  const marker = join(root, "ejecutado");
  const hooks = join(root, "hooks");
  const template = join(root, "template");
  mkdirSync(hooks);
  mkdirSync(join(template, "hooks"), { recursive: true });
  const hook = `#!/bin/sh\ntouch "${marker}"\n`;
  for (const h of [
    join(hooks, "post-checkout"),
    join(template, "hooks", "post-checkout"),
    join(clone, ".git", "hooks", "post-checkout"),
  ]) {
    writeFileSync(h, hook, { mode: 0o755 });
  }
  writeFileSync(join(clone, ".gitattributes"), "* filter=trampa\n");
  git(clone, "add", ".");
  git(clone, "commit", "-q", "-m", "atributos");
  const config = join(root, "gitconfig");
  writeFileSync(
    config,
    `[core]\n\thooksPath = ${hooks}\n[init]\n\ttemplateDir = ${template}\n` +
      `[filter "trampa"]\n\tsmudge = touch "${marker}" && cat\n`,
  );
  process.env.GIT_CONFIG_GLOBAL = config;

  // Control positivo: un clon normal con esa configuración sí ejecuta lo que hay.
  execFileSync("git", ["clone", "-q", clone, join(root, "control")]);
  assert.ok(existsSync(marker));
  rmSync(marker);

  const result = await createTaskClone(request());
  assert.ok(result.ok);
  assert.equal(existsSync(marker), false);
  assert.equal(readFileSync(join(result.tree, "a.txt"), "utf8"), "commiteado");
});

test("taskGit no se fía del fichero .git del árbol", async () => {
  const result = await createTaskClone(request());
  assert.ok(result.ok);
  const other = join(root, "otro");
  mkdirSync(other);
  git(other, "init", "-q", "-b", "otra");
  writeFileSync(join(result.tree, ".git"), `gitdir: ${join(other, ".git")}\n`);
  assert.equal(await taskGit(result, ["symbolic-ref", "HEAD"]), "refs/heads/togi/7-arreglar-login");
});

test("commit base inexistente: error claro y nada creado", async () => {
  const result = await createTaskClone(request({ baseSha: "0".repeat(40) }));
  assert.deepEqual(result, { ok: false, code: "commit_not_found" });
  assert.equal(existsSync(dir()), false);
});

test("argumentos inválidos no llegan a git ni al disco", async () => {
  const invalid = { ok: false, code: "invalid_argument" };
  for (const branch of ["main", "togi/a b", "togi/a..b", "-togi/x", "togi/"]) {
    assert.deepEqual(await createTaskClone(request({ branch })), invalid, branch);
  }
  for (const workspaceId of ["wsp_../x", "wsp_a/b", "ses_1", "wsp_", "wsp_a\0b"]) {
    const over = { workspaceId: workspaceId as `wsp_${string}` };
    assert.deepEqual(await createTaskClone(request(over)), invalid, workspaceId);
  }
  for (const baseSha of ["main", "HEAD", "--all", "abc"]) {
    assert.deepEqual(await createTaskClone(request({ baseSha })), invalid, baseSha);
  }
  assert.equal(existsSync(join(home, "workspaces")), false);
});

test("repo no registrado o cambiado tras el alta", async () => {
  const other = await createTaskClone(request({ repo: "acme/otro" }));
  assert.deepEqual(other, { ok: false, code: "repo_not_registered" });
  git(clone, "remote", "set-url", "origin", "git@github.com:acme/otro.git");
  assert.deepEqual(await createTaskClone(request()), { ok: false, code: "remote_mismatch" });
  assert.equal(existsSync(join(home, "workspaces")), false);
});

test("no pisa una copia que ya existe", async () => {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(join(dir(), "ajeno"), "x");
  assert.deepEqual(await createTaskClone(request()), { ok: false, code: "clone_failed" });
  assert.ok(existsSync(join(dir(), "ajeno")));
});

test("removeTaskClone borra el clon aunque haya carpetas sin escritura, y es idempotente", async () => {
  const result = await createTaskClone(request());
  assert.ok(result.ok);
  mkdirSync(join(result.tree, "node_modules", "x"), { recursive: true });
  writeFileSync(join(result.tree, "node_modules", "x", "f"), "f");
  chmodSync(join(result.tree, "node_modules", "x"), 0o555);
  chmodSync(join(result.tree, "node_modules"), 0o555);
  await removeTaskClone(home, WSP);
  assert.equal(existsSync(dir()), false);
  await removeTaskClone(home, WSP);
  assert.ok(existsSync(clone));
});

test("removeTaskClone rechaza un id que saldría de workspaces/", async () => {
  mkdirSync(join(home, "fuera"));
  await assert.rejects(removeTaskClone(home, "wsp_/../../fuera" as `wsp_${string}`));
  await assert.rejects(removeTaskClone(home, "ses_1" as `wsp_${string}`));
  assert.ok(existsSync(join(home, "fuera")));
});

test("taskBranch: togi/<número>-<slug> en ASCII, corto y válido para git", () => {
  assert.equal(taskBranch(7, "Arreglar el login"), "togi/7-arreglar-el-login");
  assert.equal(taskBranch(12, "  Añadir «promos» de verano!! "), "togi/12-anadir-promos-de-verano");
  assert.equal(taskBranch(3, "../..; rm -rf ~"), "togi/3-rm-rf");
  assert.equal(taskBranch(4, "¿?"), "togi/4");
  const long = taskBranch(5, "palabra ".repeat(20));
  assert.ok(long.length <= "togi/5-".length + 40, long);
  assert.ok(!long.endsWith("-"));
});
