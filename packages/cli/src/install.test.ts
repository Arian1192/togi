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
import { install } from "./install.ts";
import { plistPath, type Runner } from "./launchd.ts";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
let root: string;
let source: string;
let commit: string;
let calls: string[][];

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "togi-install-"));
  const repo = join(root, "origen");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "a");
  git(repo, "tag", "v1.0.0");
  commit = git(repo, "rev-parse", "HEAD");
  source = `file://${repo}`;
  calls = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** git es el real; pnpm y launchctl se anotan y no tocan nada. */
const fakeRun =
  (failOn?: string): Runner =>
  async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === failOn) throw new Error(`${cmd} falló`);
    return cmd === "git" ? execFileSync(cmd, args, { env: GIT_ENV, encoding: "utf8" }) : "";
  };

const deps = (over: { failOn?: string; platform?: NodeJS.Platform } = {}) => ({
  run: fakeRun(over.failOn),
  supportDir: join(root, "support"),
  agentsDir: join(root, "agents"),
  uid: 501,
  node: "/usr/local/bin/node",
  platform: over.platform ?? ("darwin" as const),
  source,
});
const home = () => join(root, "togi-home");

test("instala la etiqueta fuera de TOGI_HOME, con RELEASE de etiqueta y commit, y activa el agente", async () => {
  const done = await install(home(), "v1.0.0", deps());
  const dir = join(root, "support", "releases", "v1.0.0");
  assert.equal(done.release, dir);
  assert.ok(!dir.startsWith(home()));
  assert.deepEqual(readRelease(dir), { tag: "v1.0.0", commit });
  assert.equal(done.commit, commit);
  assert.ok(existsSync(join(dir, "a.txt")));
  assert.ok(calls.some((c) => c[0] === "pnpm" && c.includes("--frozen-lockfile")));
  assert.ok(calls.some((c) => c[0] === "pnpm" && c.includes("--ignore-scripts")));
  assert.deepEqual(calls.at(-1), [
    "launchctl",
    "bootstrap",
    "gui/501",
    plistPath(join(root, "agents")),
  ]);
  assert.deepEqual(readdirSync(join(root, "support", "releases")), ["v1.0.0"]);
});

test("el plist apunta a la instalación, nunca al origen, y solo lleva PATH y TOGI_HOME", async () => {
  await install(home(), "v1.0.0", { ...deps(), source });
  const file = plistPath(join(root, "agents"));
  const text = readFileSync(file, "utf8");
  const dir = join(root, "support", "releases", "v1.0.0");
  assert.ok(text.includes(`<string>${join(dir, "packages", "daemon", "src", "main.ts")}</string>`));
  assert.ok(text.includes(`<key>WorkingDirectory</key><string>${dir}</string>`));
  assert.ok(!text.includes("origen"));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const env = text.slice(text.indexOf("<key>EnvironmentVariables</key>"));
  assert.deepEqual(
    [...env.matchAll(/<key>(\w+)<\/key>/g)].map((m) => m[1]),
    ["EnvironmentVariables", "PATH", "TOGI_HOME"],
  );
});

test("el plist no copia process.env ni ningún secreto", async () => {
  process.env.TOGI_TOKEN = "secreto-token-123";
  process.env.ANTHROPIC_API_KEY = "secreto-clave-456";
  try {
    await install(home(), "v1.0.0", deps());
  } finally {
    delete process.env.TOGI_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
  }
  const text = readFileSync(plistPath(join(root, "agents")), "utf8");
  assert.ok(!text.includes("secreto-"));
  assert.ok(!text.includes("TOGI_TOKEN") && !text.includes("ANTHROPIC"));
});

test("crea el lanzador de la CLI instalada, ejecutable y con la ruta entre comillas", async () => {
  const done = await install(home(), "v1.0.0", deps());
  assert.equal(done.launcher, join(root, "support", "bin", "togi"));
  assert.equal(statSync(done.launcher).mode & 0o777, 0o755);
  const dir = join(root, "support", "releases", "v1.0.0");
  assert.equal(
    readFileSync(done.launcher, "utf8"),
    `#!/bin/sh\nexec '/usr/local/bin/node' '${join(dir, "packages", "cli", "bin", "togi.js")}' "$@"\n`,
  );
});

test("una etiqueta que no existe falla con un error claro y no deja plist ni carpetas a medias", async () => {
  await assert.rejects(install(home(), "v9.9.9", deps()), (e) => {
    assert.ok(e instanceof CliError);
    assert.equal(e.code, "install_failed");
    return true;
  });
  assert.ok(!existsSync(plistPath(join(root, "agents"))));
  assert.deepEqual(readdirSync(join(root, "support", "releases")), []);
  assert.ok(!calls.some((c) => c[0] === "launchctl"));
});

test("si falla pnpm install no queda la carpeta temporal ni la versión", async () => {
  await assert.rejects(install(home(), "v1.0.0", deps({ failOn: "pnpm" })), /install_failed/);
  assert.deepEqual(readdirSync(join(root, "support", "releases")), []);
  assert.ok(!existsSync(plistPath(join(root, "agents"))));
});

test("si launchctl bootstrap falla, no deja el plist", async () => {
  await assert.rejects(install(home(), "v1.0.0", deps({ failOn: "launchctl" })), /install_failed/);
  assert.ok(!existsSync(plistPath(join(root, "agents"))));
});

test("etiquetas peligrosas se rechazan antes de tocar nada", async () => {
  for (const tag of ["../x", "a/b", "-rf", "a..b", "", "a b", "--upload-pack=x"]) {
    await assert.rejects(install(home(), tag, deps()), (e) => e instanceof CliError);
  }
  assert.ok(!existsSync(join(root, "support")));
  assert.deepEqual(calls, []);
});

test("fuera de macOS da un error claro y no toca nada", async () => {
  await assert.rejects(
    install(home(), "v1.0.0", deps({ platform: "linux" })),
    (e) => e instanceof CliError && e.code === "install_unsupported",
  );
  assert.ok(!existsSync(join(root, "support")));
});

test("reinstalar una versión ya instalada no la clona otra vez y mantiene su commit", async () => {
  await install(home(), "v1.0.0", deps());
  calls = [];
  const again = await install(home(), "v1.0.0", deps());
  assert.equal(again.commit, commit);
  assert.ok(calls.filter((c) => c[0] === "git").every((c) => c[1] === "ls-remote"));
  assert.ok(!calls.some((c) => c[0] === "pnpm"));
});
