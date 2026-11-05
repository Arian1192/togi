import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { SandboxSpec } from "@togi/core";
import { Reaper } from "./reap.ts";
import { type SrtManager, SrtSandbox } from "./srt-sandbox.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-reap-")));
const scratch = join(root, "workspaces", "s1", "scratch");
const repo = join(root, "workspaces", "s1", "repo");
mkdirSync(scratch, { recursive: true });
mkdirSync(repo, { recursive: true });

const spec = (over: Partial<SandboxSpec> = {}): SandboxSpec => ({
  readPaths: [repo],
  writeDir: scratch,
  allowedDomains: [],
  allowedEnv: ["PATH"],
  credentials: [],
  timeoutMs: 5000,
  ...over,
});

/** srt simulado: ejecuta el comando tal cual. Lo que se prueba es la limpieza, no el aislamiento. */
const manager: SrtManager = {
  isSupportedPlatform: () => true,
  async initialize() {},
  async wrapWithSandboxArgv(command) {
    return { argv: ["/bin/sh", "-c", command] };
  },
  async reset() {},
};
const sandbox = () => new SrtSandbox({ togiHome: root, runtimePaths: [], home: root, manager });

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const skip =
  process.platform === "darwin" ? undefined : "Reaper solo funciona en macOS (ps -E, lsof)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Un proceso que sale de su grupo con setsid y anota su PID; `exec` es lo que ejecuta después. */
const escapee = (name: string, exec: string, tail = "") => [
  "/bin/sh",
  "-c",
  `/usr/bin/perl -MPOSIX -e 'exit 0 if fork; POSIX::setsid(); open F, ">", $ARGV[0]; print F $$; close F; exec ${exec}' "$1" </dev/null >/dev/null 2>&1; for i in 1 2 3 4 5 6 7 8 9 10; do [ -s "$1" ] && break; sleep 0.1; done; ${tail}`,
  "sh",
  join(scratch, name),
];
const pidOf = (name: string) => Number(readFileSync(join(scratch, name), "utf8"));
const settle = () => sleep(200);

test("un proceso con setsid no sobrevive a una ejecución normal", { skip }, async () => {
  await sandbox().run(spec(), escapee("normal.pid", `"sleep", "60"`));
  await settle();
  assert.equal(alive(pidOf("normal.pid")), false);
});

test("un proceso con setsid no sobrevive al tope de tiempo", { skip }, async () => {
  const r = await sandbox().run(
    spec({ timeoutMs: 800 }),
    escapee("tope.pid", `"sleep", "60"`, "sleep 30"),
  );
  await settle();
  assert.equal(r.timedOut, true);
  assert.equal(alive(pidOf("tope.pid")), false);
});

test("un proceso con setsid no sobrevive a la cancelación", { skip }, async () => {
  const controller = new AbortController();
  const run = sandbox().run(
    spec(),
    escapee("cancel.pid", `"sleep", "60"`, "sleep 30"),
    undefined,
    controller.signal,
  );
  await sleep(1000);
  controller.abort();
  await run;
  await settle();
  assert.equal(alive(pidOf("cancel.pid")), false);
});

test("un proceso que borra su entorno se encuentra por el fichero heredado", { skip }, async () => {
  await sandbox().run(
    spec(),
    escapee("sinentorno.pid", `"/usr/bin/env", "-i", "/bin/sleep", "60"`),
  );
  await settle();
  assert.equal(alive(pidOf("sinentorno.pid")), false);
});

test("al empezar una ejecución se limpia lo que escapó de la anterior, por la marca de entorno", {
  skip,
}, async () => {
  const old = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    detached: true,
    stdio: "ignore",
    env: { PATH: process.env.PATH ?? "", TOGI_RUN: `${process.pid}-anterior` },
  });
  old.unref();
  await sleep(300);
  assert.ok(old.pid && alive(old.pid));
  await sandbox().run(spec(), ["/usr/bin/true"]);
  await settle();
  assert.equal(alive(old.pid), false);
});

test("al empezar una ejecución se limpia lo que escapó de la anterior, por el fichero heredado", {
  skip,
}, async () => {
  await sandbox().run(spec(), ["/usr/bin/true"]);
  const mark = readdirSync(scratch).find((f) => f.startsWith(".togi-run-"));
  assert.ok(mark);
  const old = spawn("/bin/sleep", ["60"], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore", openSync(join(scratch, mark), "r")],
  });
  old.unref();
  assert.ok(old.pid && alive(old.pid));
  await sandbox().run(spec(), ["/usr/bin/true"]);
  await settle();
  assert.equal(alive(old.pid), false);
});

test("un proceso ajeno, sin la marca, no se toca", { skip }, async () => {
  const other = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
  other.unref();
  await sandbox().run(spec(), ["/usr/bin/true"]);
  assert.ok(other.pid && alive(other.pid));
  process.kill(other.pid, "SIGKILL");
});

test("fuera de macOS, Reaper falla con un error claro antes de ejecutar nada", () => {
  assert.throws(() => new Reaper(scratch, "linux"), /solo funciona en macOS.*linux/);
});
