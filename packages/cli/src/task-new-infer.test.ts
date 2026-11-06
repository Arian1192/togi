import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { runCli } from "./testing/run-cli.ts";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
before(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "togi-infer-")));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
});
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", dir, ...args]);

/** Un clon con remote `origin` y, si se pide, `origin/HEAD` apuntando a esa rama. */
function clone(name: string, remote: string | null, head: string | null = "main"): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  if (remote !== null) git(dir, "remote", "add", "origin", remote);
  if (head !== null) {
    git(dir, "commit", "-q", "--allow-empty", "-m", "uno");
    git(dir, "update-ref", `refs/remotes/origin/${head}`, "HEAD");
    git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${head}`);
  }
  return dir;
}
const NEW = ["task", "new", "Exportar CSV", "--risk", "low", "--no-color"];
const newIn = (cwd: string, ...extra: string[]) =>
  runCli([...NEW, ...extra], home, {}, undefined, cwd);
const tasks = () => (daemon.db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
async function shown(n: string) {
  const r = await runCli(["task", "show", n, "--json"], home);
  return JSON.parse(r.stdout) as { repo: string; baseBranch: string };
}
const created = (stdout: string) => /#(\d+)/.exec(stdout)?.[1] as string;

const registered = clone("app", "git@github.com:acme/app.git");
before(async () => {
  const added = await runCli(["repo", "add", "acme/app", "--path", registered], home);
  assert.equal(added.code, 0, added.stderr);
});

test("dentro de un clon registrado, sin --repo ni --base, se deducen y se dice", async () => {
  const r = await newIn(registered);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Repo y rama base deducidos del directorio: acme\/app → main/);
  const task = await shown(created(r.stdout));
  assert.deepEqual([task.repo, task.baseBranch], ["acme/app", "main"]);
});

test("el remote con otras mayúsculas vale y se usa el nombre registrado", async () => {
  const dir = clone("mayus", "https://github.com/ACME/App.git", "trunk");
  const r = await newIn(dir);
  assert.equal(r.code, 0, r.stderr);
  const task = await shown(created(r.stdout));
  assert.equal(task.repo, "acme/app");
  assert.equal(task.baseBranch, "trunk");
});

test("desde un subdirectorio del clon también se deduce", async () => {
  const sub = join(registered, "src", "lib");
  mkdirSync(sub, { recursive: true });
  const r = await newIn(sub);
  assert.equal(r.code, 0, r.stderr);
  assert.equal((await shown(created(r.stdout))).repo, "acme/app");
});

test("un clon cuyo repo no está registrado da error de uso con el siguiente paso, sin crear nada", async () => {
  const dir = clone("otro", "git@github.com:acme/otro.git");
  const before = tasks();
  const r = await newIn(dir);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /el repo acme\/otro de este directorio no está registrado/);
  assert.match(r.stderr, /togi repo add acme\/otro --path/);
  assert.equal(tasks(), before);
});

test("fuera de git, sin origin o con un remote que no es de GitHub, se pide --repo", async () => {
  const outside = join(root, "fuera");
  mkdirSync(outside);
  const cases: [string, RegExp][] = [
    [outside, /no está dentro de un repo git/],
    [clone("sin-origin", null, null), /no tiene un remote origin/],
    [clone("gitlab", "https://gitlab.com/acme/app.git"), /el remote origin no es de GitHub/],
  ];
  for (const [dir, why] of cases) {
    const before = tasks();
    const r = await newIn(dir);
    assert.equal(r.code, 2, dir);
    assert.match(r.stderr, why);
    assert.match(r.stderr, /--repo <owner\/repo>/);
    assert.equal(tasks(), before);
  }
});

test("un --repo explícito gana: no se deduce nada y la rama sigue siendo dev", async () => {
  const r = await newIn(registered, "--repo", "acme/explicito");
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /deducid/);
  const task = await shown(created(r.stdout));
  assert.deepEqual([task.repo, task.baseBranch], ["acme/explicito", "dev"]);
});

test("un --base explícito gana a la rama deducida, y el repo sí se deduce", async () => {
  const r = await newIn(registered, "--base", "release");
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Repo deducido del directorio: acme\/app/);
  assert.doesNotMatch(r.stdout, /rama base deducidos/);
  const task = await shown(created(r.stdout));
  assert.deepEqual([task.repo, task.baseBranch], ["acme/app", "release"]);
});

test("sin origin/HEAD, con el repo deducido, se exige --base y no se usa dev", async () => {
  const dir = clone("sin-head", "git@github.com:acme/app.git", null);
  const before = tasks();
  const r = await newIn(dir);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Se deduce el repo acme\/app pero no su rama base/);
  assert.match(r.stderr, /--base <rama>/);
  assert.match(r.stderr, /git remote set-head origin --auto/);
  assert.equal(tasks(), before);
  const ok = await newIn(dir, "--base", "main");
  assert.equal(ok.code, 0, ok.stderr);
});

test("un origin/HEAD con un nombre que la API no admite cuenta como no deducible", async () => {
  const dir = clone("rama-rara", "git@github.com:acme/app.git", "feat+x");
  const r = await newIn(dir);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--base <rama>/);
});

test("un --base inválido sin --repo sale con 2 antes de consultar al daemon", async () => {
  const r = await runCli(
    [...NEW, "--base=--force"],
    join(root, "sin-daemon"),
    {},
    undefined,
    registered,
  );
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--base/);
});

test("los errores de uso salen antes de tocar el daemon", async () => {
  const nobody = join(root, "sin-daemon");
  const r = await runCli(["task", "new", "T", "--no-color"], nobody, {}, undefined, registered);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Falta --risk/);
});
