import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { paths } from "@togi/daemon/config";
import { CliError } from "./errors.ts";
import { startDaemon } from "./lifecycle.ts";
import { runCli } from "./testing/run-cli.ts";

let root: string;
const homes: string[] = [];
const fresh = (name: string) => {
  const home = join(root, name);
  homes.push(home);
  return home;
};
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const pidOf = (home: string) => Number.parseInt(readFileSync(paths(home).pid, "utf8"), 10);

before(() => {
  root = mkdtempSync(join(tmpdir(), "togi-lc-"));
});
after(async () => {
  for (const home of homes) await runCli(["daemon", "stop"], home);
  rmSync(root, { recursive: true, force: true });
});

test("Node ejecuta el daemon desde la ruta de import.meta.resolve", () => {
  const main = fileURLToPath(import.meta.resolve("@togi/daemon/main"));
  assert.ok(existsSync(main));
  assert.ok(!main.includes("node_modules"), main);
});

test("start, status y stop con espera real", async () => {
  const home = fresh("a");
  const start = await runCli(["daemon", "start"], home);
  assert.equal(start.code, 0, start.stderr);
  const pid = pidOf(home);
  assert.match(start.stdout, new RegExp(`^✓ Daemon arrancado · pid ${pid} · .+togi\\.sock\\n$`));
  assert.equal(statSync(paths(home).pid).mode & 0o777, 0o600);
  assert.equal(statSync(paths(home).log).mode & 0o777, 0o600);
  assert.equal(statSync(paths(home).runDir).mode & 0o777, 0o700);
  assert.match((await runCli(["daemon", "status"], home)).stdout, new RegExp(`pid ${pid} `));

  const again = await runCli(["daemon", "start"], home);
  assert.equal(again.code, 0);
  assert.match(again.stdout, new RegExp(`ya está en marcha · pid ${pid}`));
  assert.equal(pidOf(home), pid);

  const stop = await runCli(["daemon", "stop"], home);
  assert.equal(stop.code, 0, stop.stderr);
  assert.match(stop.stdout, new RegExp(`Daemon parado · pid ${pid}`));
  assert.ok(!alive(pid));
  assert.ok(!existsSync(paths(home).socket));
  assert.ok(!existsSync(paths(home).pid));
});

test("stop sin daemon es idempotente", async () => {
  const r = await runCli(["daemon", "stop"], fresh("b"));
  assert.equal(r.code, 0);
  assert.match(r.stdout, /No hay ningún daemon en marcha\./);
});

test("stop con un pid ajeno en el fichero no envía ninguna señal", async () => {
  const home = fresh("c");
  assert.equal((await runCli(["daemon", "start"], home)).code, 0);
  const real = pidOf(home);
  const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    writeFileSync(paths(home).pid, `${other.pid}\n`);
    const r = await runCli(["daemon", "stop"], home);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no es el del fichero de pid/);
    assert.ok(alive(real), "el daemon sigue vivo");
    assert.ok(other.pid !== undefined && alive(other.pid), "el ajeno sigue vivo");
  } finally {
    other.kill("SIGKILL");
    writeFileSync(paths(home).pid, `${real}\n`);
  }
  assert.equal((await runCli(["daemon", "stop"], home)).code, 0);
});

test("si el daemon muere al arrancar, sale con 1 y enseña la cola del log", async () => {
  const blocker = join(root, "fichero");
  writeFileSync(blocker, "");
  const r = await runCli(["daemon", "start"], join(blocker, "h"));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /El daemon murió al arrancar|ENOTDIR/);
});

test("si el daemon no responde en el tope, SIGTERM al hijo, sin pid y salida 1", async () => {
  const home = join(root, "t");
  const marks = join(root, "fake");
  mkdirSync(marks);
  const fake = join(root, "fake.mjs");
  writeFileSync(
    fake,
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(join(marks, "pid"))}, String(process.pid));
process.on("SIGTERM", () => {
  writeFileSync(${JSON.stringify(join(marks, "term"))}, "1");
  process.exit(0);
});
setInterval(() => {}, 1000);
`,
  );
  await assert.rejects(
    startDaemon(home, { daemon: fake, limitMs: 500 }),
    (e) => e instanceof CliError && e.code === "daemon_start_timeout" && e.exitCode === 1,
  );
  assert.ok(!existsSync(paths(home).pid));
  const pid = Number.parseInt(readFileSync(join(marks, "pid"), "utf8"), 10);
  const until = Date.now() + 5000;
  while (alive(pid) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  assert.ok(!alive(pid), "el hijo terminó");
  assert.ok(existsSync(join(marks, "term")), "el hijo recibió SIGTERM");
});
