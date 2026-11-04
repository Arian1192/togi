import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { fromProblem } from "./errors.ts";
import { runCli } from "./testing/run-cli.ts";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
before(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "togi-repo-cli-")));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
});
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

const clone = (name: string, remote?: string): string => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", dir]);
  if (remote) execFileSync("git", ["-C", dir, "remote", "add", "origin", remote]);
  return dir;
};
const cli = (...args: string[]) => runCli([...args, "--no-color"], home);

test("add registra el clon, list lo muestra y --json devuelve el cuerpo", async () => {
  const dir = clone("app", "git@github.com:acme/app.git");
  const added = await cli("repo", "add", "acme/app", "--path", dir);
  assert.equal(added.code, 0, added.stderr);
  assert.match(added.stdout, /Registrado acme\/app → /);
  const list = await cli("repo", "list");
  assert.match(list.stdout, new RegExp(`acme/app +${dir} +ahora`));
  const json = JSON.parse((await cli("repo", "list", "--json")).stdout);
  assert.deepEqual(
    json.repos.map((r: { repo: string; path: string }) => [r.repo, r.path]),
    [["acme/app", dir]],
  );
  const again = await cli("repo", "remove", "acme/app");
  assert.equal(again.code, 0);
});

test("add acepta una ruta relativa y la envía absoluta", async () => {
  const dir = clone("rel", "https://github.com/acme/rel.git");
  const r = await cli("repo", "add", "acme/rel", "--path", relative(process.cwd(), dir), "--json");
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).path, dir);
  await cli("repo", "remove", "acme/rel");
});

test("cada error de validación del daemon sale con 3, su mensaje y su siguiente paso", async () => {
  const other = clone("otro", "git@github.com:acme/otro.git");
  const plain = join(root, "plano");
  mkdirSync(plain);
  const cases: [string, string, RegExp, RegExp][] = [
    [join(root, "nada"), "path_not_found", /no existe/, /Repite con una ruta válida/],
    [plain, "not_a_git_repo", /no es la raíz de un repo git/, /contiene \.git/],
    [other, "remote_mismatch", /Ningún remote .* apunta a acme\/app/, /git -C <ruta> remote -v/],
    [home, "inside_togi_home", /dentro del directorio de datos/, /fuera de él/],
  ];
  for (const [path, code, text, next] of cases) {
    const r = await cli("repo", "add", "acme/app", "--path", path);
    assert.equal(r.code, 3, code);
    assert.match(r.stderr, text, code);
    assert.match(r.stderr, next, code);
    assert.match(r.stderr, new RegExp(code));
  }
});

test("un alta duplicada sale con 3, no con 4, y sugiere repo list", async () => {
  const dir = clone("dup", "git@github.com:acme/dup.git");
  assert.equal((await cli("repo", "add", "acme/dup", "--path", dir)).code, 0);
  const r = await cli("repo", "add", "acme/dup", "--path", dir);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /acme\/dup ya está registrado/);
  assert.match(r.stderr, /togi repo list/);
  await cli("repo", "remove", "acme/dup");
});

test("fromProblem: repo_already_registered es 3 aunque el status sea 409; otros 409 siguen en 4", () => {
  assert.equal(fromProblem(409, { code: "repo_already_registered" }, {}).exitCode, 3);
  assert.equal(fromProblem(409, { code: "version_conflict" }, {}).exitCode, 4);
});

test("una ruta con caracteres de control no mueve la terminal", async () => {
  const r = await cli(
    "repo",
    "add",
    "acme/app",
    "--path",
    "/no/existe/\u001b[31mrojo\u0007\nfalso",
  );
  assert.equal(r.code, 3);
  assert.equal(r.stderr.includes("\u001b") || r.stderr.includes("\u0007"), false);
  assert.match(r.stderr, /La ruta \/no\/existe\/\[31mrojofalso no existe\./);
});

test("remove da de baja y un repo inexistente sale con 7", async () => {
  const dir = clone("baja", "git@github.com:acme/baja.git");
  await cli("repo", "add", "acme/baja", "--path", dir);
  const ok = await cli("repo", "remove", "acme/baja");
  assert.equal(ok.code, 0);
  assert.match(ok.stdout, /Dado de baja acme\/baja/);
  const missing = await cli("repo", "remove", "acme/baja");
  assert.equal(missing.code, 7);
  assert.match(missing.stderr, /acme\/baja no está registrado/);
  assert.match(missing.stderr, /togi repo list/);
});

test("list sin repos explica cómo registrar uno", async () => {
  const r = await cli("repo", "list");
  assert.equal(r.code, 0);
  assert.match(r.stdout, /No hay repos registrados\./);
  assert.match(r.stdout, /togi repo add <owner\/repo> --path <ruta>/);
});

test("errores de uso: sale con 2", async () => {
  const dir = clone("uso", "git@github.com:acme/uso.git");
  for (const args of [
    ["add", "acme/uso"],
    ["add", "no-es-un-repo", "--path", dir],
    ["add", "acme/uso", "otro", "--path", dir],
    ["remove"],
    ["remove", "../x"],
  ]) {
    assert.equal((await cli("repo", ...args)).code, 2, args.join(" "));
  }
});

test("la ayuda de cada verbo y la general listan repo", async () => {
  const add = await cli("repo", "add", "--help");
  assert.match(add.stdout, /togi repo add <owner\/repo> --path <ruta>/);
  const general = await cli("--help");
  assert.match(general.stdout, /togi repo add/);
  assert.match(general.stdout, /togi repo list/);
  assert.match(general.stdout, /togi repo remove/);
});
