import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { SandboxSpec } from "@togi/core";
import { SandboxSpecError } from "./srt-config.ts";
import { type SrtManager, SrtSandbox } from "./srt-sandbox.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-run-")));
const togiHome = join(root, "togi");
const repo = join(togiHome, "workspaces", "s1", "repo");
const scratch = join(togiHome, "workspaces", "s1", "scratch");
mkdirSync(repo, { recursive: true });
mkdirSync(scratch, { recursive: true });

const spec = (over: Partial<SandboxSpec> = {}): SandboxSpec => ({
  readPaths: [repo],
  writeDir: scratch,
  allowedDomains: [],
  allowedEnv: ["PATH", "KEEP"],
  credentials: [],
  timeoutMs: 5000,
  ...over,
});

/** srt simulado: no aísla nada, solo ejecuta el comando y anota las llamadas. */
function fakeManager(log: string[] = [], delayMs = 0): SrtManager & { configs: unknown[] } {
  const configs: unknown[] = [];
  const pause = () => new Promise((r) => setTimeout(r, delayMs));
  return {
    configs,
    isSupportedPlatform: () => true,
    async initialize(config) {
      configs.push(config);
      log.push("init");
      await pause();
    },
    async wrapWithSandboxArgv(command) {
      return { argv: ["/bin/sh", "-c", command] };
    },
    async reset() {
      await pause();
      log.push("reset");
    },
  };
}

const sandbox = (manager: SrtManager) =>
  new SrtSandbox({ togiHome, runtimePaths: [], home: join(root, "home"), manager });

test("el hijo recibe solo las variables permitidas, con HOME y TMPDIR en writeDir", async () => {
  process.env.TOGI_TEST_SECRET = "no-debe-llegar";
  process.env.KEEP = "si";
  const r = await sandbox(fakeManager()).run(spec(), ["/usr/bin/env"]);
  const env = Object.fromEntries(r.stdout.split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
  assert.equal(env.KEEP, "si");
  assert.equal(env.HOME, scratch);
  assert.equal(env.TMPDIR, scratch);
  assert.equal(env.TOGI_TEST_SECRET, undefined);
  assert.equal(r.exitCode, 0);
});

test("pasa al ejecutor la entrada, el argv entrecomillado y la configuración de srt", async () => {
  const m = fakeManager();
  const r = await sandbox(m).run(spec(), ["/bin/cat"], "hola");
  assert.equal(r.stdout, "hola");
  const quoted = await sandbox(m).run(spec(), ["/bin/echo", "a b", "it's"]);
  assert.equal(quoted.stdout, "a b it's\n");
  assert.equal(m.configs.length, 2);
});

test("el tope de tiempo mata el proceso", async () => {
  const start = Date.now();
  const r = await sandbox(fakeManager()).run(spec({ timeoutMs: 150 }), [
    "/bin/sh",
    "-c",
    "exec sleep 5",
  ]);
  assert.equal(r.timedOut, true);
  assert.equal(r.exitCode, null);
  assert.ok(Date.now() - start < 3000);
});

test("dos ejecuciones a la vez se serializan", async () => {
  const log: string[] = [];
  const s = sandbox(fakeManager(log, 30));
  await Promise.all([s.run(spec(), ["/bin/true"]), s.run(spec(), ["/bin/true"])]);
  assert.deepEqual(log, ["init", "reset", "init", "reset"]);
});

test("una especificación no válida se rechaza antes de tocar srt", async () => {
  const log: string[] = [];
  await assert.rejects(
    sandbox(fakeManager(log)).run(spec({ allowedDomains: ["*.example.com"] }), ["/bin/true"]),
    SandboxSpecError,
  );
  assert.deepEqual(log, []);
});

test("se niega si la plataforma no está soportada", async () => {
  const m = { ...fakeManager(), isSupportedPlatform: () => false };
  await assert.rejects(sandbox(m).run(spec(), ["/bin/true"]), /no está soportado/);
});

test("reinicia srt aunque la ejecución falle", async () => {
  const log: string[] = [];
  const m = fakeManager(log);
  m.wrapWithSandboxArgv = async () => {
    throw new Error("falla");
  };
  await assert.rejects(sandbox(m).run(spec(), ["/bin/true"]), /falla/);
  assert.deepEqual(log, ["init", "reset"]);
});

test("el proceso recibe como texto literal las comillas, «;» y «$(...)» del argv", async () => {
  const marker = join(scratch, "inyectado");
  const args = [
    "it's",
    "a b",
    `x; touch ${marker}`,
    `$(touch ${marker})`,
    `\`touch ${marker}\``,
    "a && b | c > d",
    "'; touch x; '",
    "",
  ];
  const dump = "console.log(JSON.stringify(process.argv.slice(1)))";
  const r = await sandbox(fakeManager()).run(spec(), [process.execPath, "-e", dump, ...args]);
  assert.deepEqual(JSON.parse(r.stdout), args);
  assert.equal(existsSync(marker), false);
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("tras el tope no queda vivo ningún proceso de la ejecución, nietos incluidos", async () => {
  const pidFile = join(scratch, "nieto.pid");
  const start = Date.now();
  // El shell lanza un nieto que no es su último comando, así que no se puede «ejecutar encima».
  const script = `sleep 30 & echo $! > ${pidFile}; wait`;
  const r = await sandbox(fakeManager()).run(spec({ timeoutMs: 300 }), ["/bin/sh", "-c", script]);
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - start < 3000);
  const grandchild = Number(readFileSync(pidFile, "utf8"));
  assert.ok(grandchild > 1);
  for (let i = 0; i < 40 && alive(grandchild); i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(alive(grandchild), false, "el nieto sigue vivo");
});

test("tras terminar con normalidad no queda ningún proceso en segundo plano", async () => {
  const pidFile = join(scratch, "fondo.pid");
  const r = await sandbox(fakeManager()).run(spec(), [
    "/bin/sh",
    "-c",
    `sleep 30 >/dev/null 2>&1 & echo $! > ${pidFile}`,
  ]);
  assert.equal(r.timedOut, false);
  const pid = Number(readFileSync(pidFile, "utf8"));
  for (let i = 0; i < 40 && alive(pid); i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(alive(pid), false, "el proceso en segundo plano sigue vivo");
});
