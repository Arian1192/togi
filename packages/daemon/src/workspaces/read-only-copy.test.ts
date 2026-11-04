import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import Database from "better-sqlite3";
import { createReadOnlyCopy, removeReadOnlyCopy, withReadOnlyCopy } from "./read-only-copy.ts";

let root: string;
let home: string;
let clone: string;
let db: Database.Database;
const SES = "ses_1";
const REMOTE = "git@github.com:acme/app.git";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
const request = (over: Partial<Parameters<typeof createReadOnlyCopy>[0]> = {}) => ({
  db,
  home,
  repo: "acme/app",
  baseBranch: "main",
  sessionId: SES,
  ...over,
});
const register = (path = clone) =>
  db
    .prepare("INSERT INTO repos (repo, path, added_at) VALUES (?, ?, ?)")
    .run("acme/app", path, "x");

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "togi-copy-")));
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
  register();
});
afterEach(async () => {
  await removeReadOnlyCopy(join(home, "workspaces"));
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const workspace = () => join(home, "workspaces", SES);

test("la copia tiene el commit de la rama base y no los cambios del clon", async () => {
  writeFileSync(join(clone, "a.txt"), "sin commitear");
  writeFileSync(join(clone, "nuevo.txt"), "sin seguimiento");
  const before = git(clone, "status", "--porcelain");
  const result = await createReadOnlyCopy(request());
  assert.ok(result.ok);
  assert.equal(result.path, workspace());
  assert.equal(result.baseSha, git(clone, "rev-parse", "main"));
  assert.equal(result.source, "local");
  assert.equal(readFileSync(join(result.path, "a.txt"), "utf8"), "commiteado");
  assert.equal(existsSync(join(result.path, "nuevo.txt")), false);
  assert.equal(existsSync(join(result.path, ".git")), false);
  assert.equal(git(clone, "status", "--porcelain"), before);
  assert.equal(git(clone, "worktree", "list").split("\n").length, 1);
});

test("origin/<rama> tiene prioridad sobre la rama local", async () => {
  const old = git(clone, "rev-parse", "HEAD");
  writeFileSync(join(clone, "a.txt"), "dos");
  git(clone, "commit", "-q", "-am", "dos");
  git(clone, "update-ref", "refs/remotes/origin/main", old);
  const result = await createReadOnlyCopy(request());
  assert.ok(result.ok);
  assert.equal(result.source, "origin");
  assert.equal(result.baseSha, old);
  assert.equal(readFileSync(join(result.path, "a.txt"), "utf8"), "commiteado");
});

test("no ejecuta ningún hook del repo, ni con core.hooksPath", async () => {
  const script = (marker: string) => `#!/bin/sh\ntouch "${join(root, marker)}"\n`;
  mkdirSync(join(clone, "hooks"));
  writeFileSync(join(clone, "hooks", "post-checkout"), script("por-hookspath"), { mode: 0o755 });
  writeFileSync(join(clone, ".git", "hooks", "post-checkout"), script("por-defecto"), {
    mode: 0o755,
  });
  git(clone, "add", ".");
  git(clone, "commit", "-q", "-m", "hooks");
  git(clone, "config", "core.hooksPath", join(clone, "hooks"));
  const result = await createReadOnlyCopy(request());
  assert.ok(result.ok);
  assert.equal(existsSync(join(root, "por-hookspath")), false);
  assert.equal(existsSync(join(root, "por-defecto")), false);
});

test("elimina los enlaces que salen de la copia y conserva los internos", async () => {
  symlinkSync("/etc/hosts", join(clone, "absoluto"));
  symlinkSync("../../fuera", join(clone, "escapa"));
  symlinkSync("a.txt", join(clone, "interno"));
  git(clone, "add", ".");
  git(clone, "commit", "-q", "-m", "enlaces");
  const result = await createReadOnlyCopy(request());
  assert.ok(result.ok);
  const names = readdirSync(result.path);
  assert.ok(!names.includes("absoluto") && !names.includes("escapa"));
  assert.equal(readFileSync(join(result.path, "interno"), "utf8"), "commiteado");
});

test("nada queda con permiso de escritura", async () => {
  mkdirSync(join(clone, "src"));
  writeFileSync(join(clone, "src", "b.txt"), "b");
  git(clone, "add", ".");
  git(clone, "commit", "-q", "-m", "src");
  const result = await createReadOnlyCopy(request());
  assert.ok(result.ok);
  for (const p of [result.path, join(result.path, "src"), join(result.path, "src", "b.txt")]) {
    assert.equal(statSync(p).mode & 0o222, 0, p);
  }
  assert.throws(() => writeFileSync(join(result.path, "a.txt"), "x"), { code: "EACCES" });
});

test("withReadOnlyCopy la borra al terminar y también si la función lanza", async () => {
  const seen = await withReadOnlyCopy(request(), async (copy) => existsSync(copy.path));
  assert.deepEqual(seen, { ok: true, value: true });
  assert.equal(existsSync(workspace()), false);
  await assert.rejects(
    withReadOnlyCopy(request(), async () => {
      throw new Error("falla");
    }),
    /falla/,
  );
  assert.equal(existsSync(workspace()), false);
});

test("rama inexistente: error claro y nada creado", async () => {
  const result = await createReadOnlyCopy(request({ baseBranch: "nada" }));
  assert.deepEqual(result, { ok: false, code: "branch_not_found" });
  assert.equal(existsSync(join(home, "workspaces")), false);
});

test("argumentos inválidos no llegan a git ni al disco", async () => {
  const invalid = { ok: false, code: "invalid_argument" };
  for (const baseBranch of ["--output=x", "a b", "a..b", "@{-1}", ""]) {
    assert.deepEqual(await createReadOnlyCopy(request({ baseBranch })), invalid, baseBranch);
  }
  for (const sessionId of ["../x", "ses_../x", "ses_a/b", "sesion", "ses_a\0b"]) {
    assert.deepEqual(await createReadOnlyCopy(request({ sessionId })), invalid, sessionId);
  }
  const shellLike = await createReadOnlyCopy(request({ baseBranch: "a;touch-x" }));
  assert.deepEqual(shellLike, { ok: false, code: "branch_not_found" });
  assert.equal(existsSync(join(home, "workspaces")), false);
});

test("repo no registrado", async () => {
  const result = await createReadOnlyCopy(request({ repo: "acme/otro" }));
  assert.deepEqual(result, { ok: false, code: "repo_not_registered" });
});

test("si el repo cambió tras el alta, falla sin crear nada", async () => {
  const untouched = () => {
    assert.equal(existsSync(join(home, "workspaces")), false);
    assert.equal(git(clone, "worktree", "list").split("\n").length, 1);
  };
  git(clone, "remote", "set-url", "origin", "git@github.com:acme/otro.git");
  assert.deepEqual(await createReadOnlyCopy(request()), { ok: false, code: "remote_mismatch" });
  untouched();
  git(clone, "remote", "set-url", "origin", REMOTE);

  const moved = join(root, "movido");
  renameSync(clone, moved);
  assert.deepEqual(await createReadOnlyCopy(request()), { ok: false, code: "path_not_found" });
  assert.equal(existsSync(join(home, "workspaces")), false);

  const inHome = join(home, "clon");
  renameSync(moved, inHome);
  db.prepare("UPDATE repos SET path = ?").run(inHome);
  assert.deepEqual(await createReadOnlyCopy(request()), { ok: false, code: "inside_togi_home" });
  assert.equal(existsSync(join(home, "workspaces")), false);
});
