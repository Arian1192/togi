import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { pnpmLockDir } from "../../../worker/src/sandbox/srt-config.ts";
import { createInstallRunner, type InstallRequest } from "./install-runner.ts";

// Con el trabajador y el srt reales: la instalación (ADR-011 §4) corre en el árbol del clon, sin
// agente, y solo sale a los dominios del registro del perfil.

const skip = process.platform === "darwin" ? undefined : "srt solo funciona en macOS (Seatbelt)";
const ENTRY = join(import.meta.dirname, "..", "..", "..", "worker", "src", "main.ts");
const REGISTRY = "registry.npmjs.org";

let root: string;
let request: Omit<InstallRequest, "profile">;
let pnpm: string;
before(() => {
  if (skip) return;
  root = realpathSync(mkdtempSync(join(tmpdir(), "togi-install-srt-")));
  const dir = join(root, "togi", "workspaces", "wsp_1");
  const tree = join(dir, "tree");
  mkdirSync(tree, { recursive: true });
  // Un proyecto sin dependencias con su lockfile, escrito por el pnpm de verdad fuera del sandbox.
  writeFileSync(join(tree, "package.json"), '{"name":"fixture","version":"1.0.0","private":true}');
  execFileSync("pnpm", ["install", "--lockfile-only"], { cwd: tree, stdio: "ignore" });
  pnpm = realpathSync(execFileSync("/usr/bin/which", ["pnpm"], { encoding: "utf8" }).trim());
  // Como lo deja pnpm fuera del sandbox (ver srt-work-tree.srt.test.ts).
  mkdirSync(pnpmLockDir(process.getuid?.() ?? 0), { recursive: true, mode: 0o700 });
  request = {
    paths: { tree, gitDir: join(dir, "git") },
    // Node y el paquete de pnpm, que en la CI están en la carpeta personal, denegada.
    runtimePaths: [dirname(realpathSync(process.execPath)), dirname(dirname(pnpm))],
    timeoutMs: 60_000,
  };
});
after(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const runner = createInstallRunner({ workerEntry: ENTRY });
const install = (command: string, timeoutMs = 60_000) =>
  runner.run({ ...request, timeoutMs, profile: { install: command, registry: [REGISTRY] } });

test("instala un proyecto con lockfile dentro de srt, en el árbol del clon", { skip }, async () => {
  const result = await install(`${pnpm} install --frozen-lockfile --offline`);
  assert.equal(result.status, "ok", result.output);
  assert.ok(existsSync(join(request.paths.tree, "node_modules")));
  assert.equal(existsSync(join(request.paths.tree, "install")), false); // HOME, fuera del árbol
});

test("la red llega al registro del perfil y a nada más", { skip }, async () => {
  const curl = (host: string) => install(`/usr/bin/curl -s -m10 -o /dev/null https://${host}/`);
  assert.deepEqual(await curl(REGISTRY), { status: "ok", output: "" });
  const denied = await curl("example.com");
  assert.equal(denied.status, "failed");
  assert.notEqual(denied.status === "failed" && denied.exitCode, 0);
});

test("una instalación que no acaba se para con el tope de tiempo", { skip }, async () => {
  assert.equal((await install("/bin/sleep 30", 2000)).status, "timeout");
});
