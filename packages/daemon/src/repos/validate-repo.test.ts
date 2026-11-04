import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { validateRepo } from "./validate-repo.ts";

let root: string;
let home: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "togi-repos-")));
  home = join(root, "home");
  mkdirSync(home);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Clon de prueba: git init y, si se pide, un remote. */
const clone = (dir: string, remote?: string): string => {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", dir]);
  if (remote) execFileSync("git", ["-C", dir, "remote", "add", "origin", remote]);
  return dir;
};

test("acepta https, ssh y git@ con o sin .git, sin distinguir mayúsculas", async () => {
  for (const url of [
    "https://github.com/Acme/App.git",
    "https://user@github.com/acme/app",
    "git@github.com:acme/app.git",
    "ssh://git@github.com/acme/app.git",
  ]) {
    const dir = clone(join(root, "ok"), url);
    assert.deepEqual(await validateRepo("acme/app", dir, home), { ok: true, path: dir }, url);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guarda la ruta resuelta: un enlace simbólico se sustituye por su destino", async () => {
  const dir = clone(join(root, "real"), "git@github.com:acme/app.git");
  symlinkSync(dir, join(root, "enlace"));
  assert.deepEqual(await validateRepo("acme/app", join(root, "enlace"), home), {
    ok: true,
    path: dir,
  });
});

test("una ruta inexistente se rechaza", async () => {
  assert.deepEqual(await validateRepo("acme/app", join(root, "nada"), home), {
    ok: false,
    code: "path_not_found",
  });
});

test("un directorio que no es repo git se rechaza", async () => {
  mkdirSync(join(root, "plano"));
  assert.deepEqual(await validateRepo("acme/app", join(root, "plano"), home), {
    ok: false,
    code: "not_a_git_repo",
  });
});

test("un subdirectorio de un repo no es la raíz y se rechaza", async () => {
  const dir = clone(join(root, "r"), "git@github.com:acme/app.git");
  mkdirSync(join(dir, "src"));
  const result = await validateRepo("acme/app", join(dir, "src"), home);
  assert.deepEqual(result, { ok: false, code: "not_a_git_repo" });
});

test("un remote de otro repo, o sin remote, se rechaza", async () => {
  const other = clone(join(root, "otro"), "https://github.com/acme/otro.git");
  const none = clone(join(root, "sin"));
  const mismatch = { ok: false, code: "remote_mismatch" };
  assert.deepEqual(await validateRepo("acme/app", other, home), mismatch);
  assert.deepEqual(await validateRepo("acme/app", none, home), mismatch);
});

test("un remote de otro host con el mismo owner/repo se rechaza", async () => {
  const dir = clone(join(root, "gl"), "https://gitlab.com/acme/app.git");
  assert.deepEqual(await validateRepo("acme/app", dir, home), {
    ok: false,
    code: "remote_mismatch",
  });
});

test("una ruta dentro de TOGI_HOME se rechaza, también por enlace simbólico", async () => {
  const dir = clone(join(home, "clon"), "git@github.com:acme/app.git");
  const inside = { ok: false, code: "inside_togi_home" };
  assert.deepEqual(await validateRepo("acme/app", dir, home), inside);
  symlinkSync(dir, join(root, "enlace"));
  assert.deepEqual(await validateRepo("acme/app", join(root, "enlace"), home), inside);
});

test("una carpeta hermana con el mismo prefijo que TOGI_HOME no cuenta como dentro", async () => {
  const dir = clone(join(root, "home-otro"), "git@github.com:acme/app.git");
  assert.equal((await validateRepo("acme/app", dir, home)).ok, true);
});
