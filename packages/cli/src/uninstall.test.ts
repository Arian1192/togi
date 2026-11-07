import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { CliError } from "./errors.ts";
import { install, uninstall } from "./install.ts";
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
let calls: string[][];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "togi-uninstall-"));
  const repo = join(root, "origen");
  mkdirSync(repo);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, env: GIT_ENV, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a");
  git("add", ".");
  git("commit", "-q", "-m", "a");
  git("tag", "v1.0.0");
  source = `file://${repo}`;
  calls = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** git es el real; pnpm y launchctl se anotan. `failOn` hace fallar a un programa. */
const fakeRun =
  (failOn?: string): Runner =>
  async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === failOn || (failOn !== undefined && args[0] === failOn)) {
      throw new Error(`${cmd} ${args[0]} falló`);
    }
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

test("uninstall hace bootout, borra el plist y no toca TOGI_HOME, las versiones ni el lanzador", async () => {
  await install(home(), "v1.0.0", deps());
  mkdirSync(home(), { recursive: true });
  writeFileSync(join(home(), "dato"), "mio");
  calls = [];
  assert.deepEqual(await uninstall(deps()), { removed: true });
  assert.deepEqual(calls, [["launchctl", "bootout", "gui/501/com.togi.daemon"]]);
  assert.ok(!existsSync(plist()));
  assert.equal(readFileSync(join(home(), "dato"), "utf8"), "mio");
  assert.deepEqual(readdirSync(join(root, "support", "releases")), ["v1.0.0"]);
  assert.ok(existsSync(join(root, "support", "bin", "togi")));
});

test("uninstall sin plist lo dice sin error y no llama a launchctl", async () => {
  assert.deepEqual(await uninstall(deps()), { removed: false });
  assert.deepEqual(calls, []);
});

test("uninstall tolera que el agente ya no estuviera cargado", async () => {
  await install(home(), "v1.0.0", deps());
  assert.deepEqual(await uninstall(deps(fakeRun("bootout"))), { removed: true });
  assert.ok(!existsSync(plist()));
});

test("uninstall fuera de macOS da un error claro y no toca nada", async () => {
  await install(home(), "v1.0.0", deps());
  calls = [];
  await assert.rejects(
    uninstall(deps(fakeRun(), "linux")),
    (e) => e instanceof CliError && e.code === "install_unsupported",
  );
  assert.deepEqual(calls, []);
  assert.ok(existsSync(plist()));
});

const onlyMac = process.platform === "darwin" ? false : "togi uninstall solo funciona en macOS";
const onlyLinux = process.platform === "linux" ? false : "esta comprobación es de Linux";

/** Un HOME vacío: el comando no puede tocar los LaunchAgents reales. */
function emptyHome() {
  const userHome = join(root, "user");
  mkdirSync(userHome);
  return { HOME: userHome };
}

test("togi uninstall por la CLI real, con un HOME sin LaunchAgent", { skip: onlyMac }, async () => {
  const env = emptyHome();
  const none = await runCli(["uninstall", "--no-color"], home(), env);
  assert.equal(none.code, 0);
  assert.match(none.stdout, /No había ningún LaunchAgent instalado/);
  const json = await runCli(["uninstall", "--json"], home(), env);
  assert.deepEqual(JSON.parse(json.stdout), { removed: false });
});

test("togi uninstall rechaza un argumento y tiene ayuda, en cualquier plataforma", async () => {
  const env = emptyHome();
  const extra = await runCli(["uninstall", "algo"], home(), env);
  assert.notEqual(extra.code, 0);
  assert.match(extra.stderr, /togi uninstall no admite ninguno/);
  const help = await runCli(["uninstall", "--help"], home(), env);
  assert.match(help.stdout, /Uso: togi uninstall/);
});

test("en Linux, togi uninstall dice que solo funciona en macOS, con salida 1", {
  skip: onlyLinux,
}, async () => {
  const r = await runCli(["uninstall", "--no-color"], home(), emptyHome());
  assert.equal(r.code, 1);
  assert.match(r.stderr, /solo funcionan en macOS/);
  assert.equal(r.stdout, "");
});
