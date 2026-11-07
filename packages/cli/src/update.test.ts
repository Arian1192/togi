import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { readRelease } from "@togi/daemon/release";
import { CliError } from "./errors.ts";
import { install, update } from "./install.ts";
import { plistPath, type Runner } from "./launchd.ts";
import { runCli } from "./testing/run-cli.ts";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
let root: string;
let source: string;
let commits: Record<string, string>;
let calls: string[][];

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "togi-update-"));
  const repo = join(root, "origen");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  commits = {};
  for (const tag of ["v1.0.0", "v2.0.0"]) {
    writeFileSync(join(repo, "a.txt"), tag);
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", tag);
    git(repo, "tag", tag);
    commits[tag] = git(repo, "rev-parse", "HEAD");
  }
  source = `file://${repo}`;
  calls = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** git es el real; pnpm y launchctl se anotan. `fail` decide qué llamada falla. */
const fakeRun =
  (fail: (call: string[]) => boolean = () => false): Runner =>
  async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (fail([cmd, ...args])) throw new Error(`${cmd} ${args[0]} falló`);
    return cmd === "git" ? execFileSync(cmd, args, { env: GIT_ENV, encoding: "utf8" }) : "";
  };

const deps = (run: Runner = fakeRun(), platform: NodeJS.Platform = "darwin") => ({
  run,
  supportDir: join(root, "support"),
  agentsDir: join(root, "agents"),
  uid: 501,
  node: "/usr/local/bin/node",
  platform,
  source,
});
const home = () => join(root, "togi-home");
const plist = () => plistPath(join(root, "agents"));
const launcher = () => join(root, "support", "bin", "togi");
const releases = () => readdirSync(join(root, "support", "releases")).sort();

test("update instala la etiqueta nueva, reescribe el plist y el lanzador y reinicia el daemon", async () => {
  await install(home(), "v1.0.0", deps());
  calls = [];
  const done = await update(home(), "v2.0.0", deps());
  const dir2 = join(root, "support", "releases", "v2.0.0");
  assert.deepEqual(readRelease(dir2), { tag: "v2.0.0", commit: commits["v2.0.0"] });
  assert.equal(done.commit, commits["v2.0.0"]);
  assert.ok(
    readFileSync(plist(), "utf8").includes(join(dir2, "packages", "daemon", "src", "main.ts")),
  );
  assert.ok(
    readFileSync(launcher(), "utf8").includes(join(dir2, "packages", "cli", "bin", "togi.js")),
  );
  assert.equal(statSync(plist()).mode & 0o777, 0o600);
  const ctl = calls.filter((c) => c[0] === "launchctl");
  assert.deepEqual(
    ctl.map((c) => c[1]),
    ["bootout", "bootstrap"],
  );
  assert.deepEqual(ctl[1], ["launchctl", "bootstrap", "gui/501", plist()]);
});

test("update deja la versión anterior intacta", async () => {
  await install(home(), "v1.0.0", deps());
  await update(home(), "v2.0.0", deps());
  assert.deepEqual(releases(), ["v1.0.0", "v2.0.0"]);
  const dir1 = join(root, "support", "releases", "v1.0.0");
  assert.deepEqual(readRelease(dir1), { tag: "v1.0.0", commit: commits["v1.0.0"] });
  assert.equal(readFileSync(join(dir1, "a.txt"), "utf8"), "v1.0.0");
});

test("si no se puede instalar la nueva, el plist y el lanzador no cambian y no se reinicia", async () => {
  await install(home(), "v1.0.0", deps());
  const before = {
    plist: readFileSync(plist(), "utf8"),
    launcher: readFileSync(launcher(), "utf8"),
  };
  for (const [tag, run] of [
    ["v9.9.9", fakeRun()],
    ["v2.0.0", fakeRun((c) => c[0] === "pnpm")],
  ] as const) {
    calls = [];
    await assert.rejects(update(home(), tag, deps(run)), (e) => {
      assert.ok(e instanceof CliError);
      assert.equal(e.code, "update_failed");
      return true;
    });
    assert.equal(readFileSync(plist(), "utf8"), before.plist);
    assert.equal(readFileSync(launcher(), "utf8"), before.launcher);
    assert.ok(!calls.some((c) => c[0] === "launchctl"), "no se reinicia");
    assert.deepEqual(releases(), ["v1.0.0"], "sin carpetas a medias");
  }
});

test("si falla al activar la nueva, se restauran el plist y el lanzador y se recarga el agente", async () => {
  await install(home(), "v1.0.0", deps());
  const before = {
    plist: readFileSync(plist(), "utf8"),
    launcher: readFileSync(launcher(), "utf8"),
  };
  calls = [];
  // El primer bootstrap de update (el de la versión nueva) falla; el de la restauración funciona.
  let bootstraps = 0;
  const run = fakeRun((c) => c[1] === "bootstrap" && ++bootstraps === 1);
  await assert.rejects(update(home(), "v2.0.0", deps(run)), (e) => {
    assert.ok(e instanceof CliError);
    assert.equal(e.code, "update_failed");
    assert.match(e.context.detail ?? "", /Se restauró la versión anterior/);
    return true;
  });
  assert.equal(readFileSync(plist(), "utf8"), before.plist);
  assert.equal(readFileSync(launcher(), "utf8"), before.launcher);
  assert.equal(statSync(plist()).mode & 0o777, 0o600);
  assert.equal(statSync(launcher()).mode & 0o777, 0o755);
  assert.deepEqual(calls.at(-1), ["launchctl", "bootstrap", "gui/501", plist()]);
  assert.deepEqual(releases(), ["v1.0.0", "v2.0.0"], "la versión nueva ya instalada se conserva");
});

test("si además falla la recarga del agente anterior, el error lo dice", async () => {
  await install(home(), "v1.0.0", deps());
  const before = readFileSync(plist(), "utf8");
  const run = fakeRun((c) => c[1] === "bootstrap");
  await assert.rejects(update(home(), "v2.0.0", deps(run)), (e) => {
    assert.ok(e instanceof CliError);
    assert.match(e.context.detail ?? "", /No se pudo reactivar la anterior/);
    return true;
  });
  assert.equal(readFileSync(plist(), "utf8"), before);
});

test("update sin instalación previa lo dice y no hace nada", async () => {
  await assert.rejects(
    update(home(), "v1.0.0", deps()),
    (e) => e instanceof CliError && e.code === "not_installed",
  );
  assert.deepEqual(calls, []);
  assert.ok(!existsSync(join(root, "support")));
});

test("update rechaza etiquetas peligrosas y otras plataformas antes de tocar nada", async () => {
  await install(home(), "v1.0.0", deps());
  calls = [];
  for (const tag of ["../x", "a/b", "-rf"]) {
    await assert.rejects(update(home(), tag, deps()), (e) => e instanceof CliError);
  }
  await assert.rejects(
    update(home(), "v2.0.0", deps(fakeRun(), "linux")),
    (e) => e instanceof CliError && e.code === "install_unsupported",
  );
  assert.deepEqual(calls, []);
});

const onlyMac = process.platform === "darwin" ? false : "togi update solo funciona en macOS";
const onlyLinux = process.platform === "linux" ? false : "esta comprobación es de Linux";

/** Un HOME vacío: el comando no puede tocar los LaunchAgents reales. */
function emptyHome() {
  const userHome = join(root, "user");
  mkdirSync(userHome);
  return { HOME: userHome };
}

test("togi update por la CLI real, con un HOME sin instalación, dice que no hay nada que actualizar", {
  skip: onlyMac,
}, async () => {
  const r = await runCli(["update", "v1.0.0", "--no-color"], home(), emptyHome());
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No hay ninguna instalación que actualizar/);
  assert.match(r.stderr, /togi install <etiqueta>/);
});

test("togi update exige una etiqueta y tiene ayuda, en cualquier plataforma", async () => {
  const env = emptyHome();
  const usage = await runCli(["update"], home(), env);
  assert.notEqual(usage.code, 0);
  assert.match(usage.stderr, /togi update admite exactamente una/);
  const help = await runCli(["update", "--help"], home(), env);
  assert.match(help.stdout, /Uso: togi update <etiqueta>/);
});

test("en Linux, togi update dice que solo funciona en macOS, con salida 1", {
  skip: onlyLinux,
}, async () => {
  const r = await runCli(["update", "v1.0.0", "--no-color"], home(), emptyHome());
  assert.equal(r.code, 1);
  assert.match(r.stderr, /solo funcionan en macOS/);
  assert.equal(r.stdout, "");
});
