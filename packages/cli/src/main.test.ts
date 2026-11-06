import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { paths } from "@togi/daemon/config";
import { startDaemon } from "../../daemon/src/start.ts";
import { runCli } from "./testing/run-cli.ts";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
before(async () => {
  root = mkdtempSync(join(tmpdir(), "togi-cli-"));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
});
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

test("sin daemon, status sale con 6 y el mensaje de la guía", async () => {
  const r = await runCli(["daemon", "status"], join(root, "vacio"));
  assert.equal(r.code, 6);
  assert.match(r.stderr, /No hay ningún daemon escuchando en el socket\./);
  assert.match(r.stderr, /togi daemon start/);
});

test("con daemon, status muestra la versión y sale con 0", async () => {
  const r = await runCli(["daemon", "status"], home);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^✓ Daemon en marcha · versión .+ · .+togi\.sock\n$/);
  assert.ok(!r.stdout.includes("\x1b["), "sin terminal no hay color");
  assert.ok(
    (await runCli(["daemon", "status"], home, { FORCE_COLOR: "1" })).stdout.includes("\x1b["),
  );
});

test("status muestra el pid que devuelve /v1/health", async () => {
  const r = await runCli(["daemon", "status"], home);
  assert.match(r.stdout, new RegExp(`pid ${process.pid} `));
});

test("--json: stdout es JSON de la API y sin daemon el error va a stderr", async () => {
  const ok = await runCli(["daemon", "status", "--json"], home);
  assert.deepEqual(Object.keys(JSON.parse(ok.stdout)).sort(), [
    "daemon",
    "lastSeq",
    "pid",
    "release",
    "schema",
  ]);
  const fail = await runCli(["daemon", "status", "--json"], join(root, "vacio"));
  assert.equal(fail.stdout, "");
  assert.equal(fail.code, 6);
});

test("credentials alterado: 401 con su mensaje, req id y salida 5", async () => {
  const bad = join(root, "bad");
  const other = await startDaemon(bad, { TOGI_KEYCHAIN: "file" });
  try {
    writeFileSync(paths(bad).credentials, "token-falso\n");
    const r = await runCli(["daemon", "status"], bad);
    assert.equal(r.code, 5);
    assert.match(r.stderr, /El token no es válido\./);
    assert.match(r.stderr, /unauthorized · req [\w.:-]+\n$/);
  } finally {
    await other.close();
  }
});

test("--help y daemon --help traen un ejemplo", async () => {
  for (const args of [["--help"], ["daemon", "--help"]]) {
    const r = await runCli(args, home);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Ejemplo: togi daemon status/);
  }
});

test("un comando mal escrito sugiere el parecido y sale con 2", async () => {
  for (const [args, hint] of [
    [["daemn", "status"], "togi daemon"],
    [["daemon", "statsu"], "togi daemon status"],
  ] as const) {
    const r = await runCli([...args], home);
    assert.equal(r.code, 2);
    assert.match(r.stderr, new RegExp(`¿Querías decir ${hint}\\?`));
  }
});
