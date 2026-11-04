import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { paths } from "@togi/daemon/config";
import { startDaemon } from "../../daemon/src/start.ts";
import { openEventDatabase } from "../../daemon/src/store/database.ts";
import { runCli } from "./testing/run-cli.ts";
import { type RunningCli, spawnCli } from "./testing/spawn-cli.ts";

const LINE = /^\d\d:\d\d:\d\d {2}#(\d+) {2}task\.created +#(\d+) {2}usr_[0-9a-f]{32}$/;

async function newTask(home: string, title: string): Promise<void> {
  const r = await runCli(["task", "new", title, "--risk", "low", "--repo", "o/r"], home);
  assert.equal(r.code, 0, r.stderr);
}

async function withDaemon(body: (home: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "togi-watch-"));
  const home = join(root, "home");
  const daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
  try {
    await body(home);
  } finally {
    await daemon.close();
    rmSync(root, { recursive: true, force: true });
  }
}

/** Crea tareas hasta que `watch` enseña la primera: así se sabe que ya está conectado. */
async function untilConnected(home: string, w: RunningCli): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!w.stdout().includes("\n")) {
    assert.ok(Date.now() < deadline, `watch no mostró nada: ${w.stderr()}`);
    await newTask(home, "Sonda");
  }
}

const stop = async (w: RunningCli) => {
  w.child.kill("SIGINT");
  await w.exit;
};

test("watch muestra los eventos de tareas creadas después de conectarse, no el historial", () =>
  withDaemon(async (home) => {
    await newTask(home, "Antes");
    const w = spawnCli(["watch"], home);
    await untilConnected(home, w);
    await stop(w);
    const lines = w.stdout().trimEnd().split("\n");
    for (const line of lines) assert.match(line, LINE);
    assert.ok(Number(LINE.exec(lines[0] ?? "")?.[1]) > 1, "no debe reproducir el evento #1");
  }));

test("--from-start reproduce el historial desde el evento #1", () =>
  withDaemon(async (home) => {
    await newTask(home, "Antes");
    const w = spawnCli(["watch", "--from-start"], home);
    const deadline = Date.now() + 15_000;
    while (!w.stdout().includes("\n") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await stop(w);
    assert.match(w.stdout().split("\n")[0] ?? "", /^\d\d:\d\d:\d\d {2}#1 {2}task\.created/);
  }));

test("--json escribe un objeto por línea", () =>
  withDaemon(async (home) => {
    const w = spawnCli(["watch", "--json"], home);
    await untilConnected(home, w);
    await stop(w);
    const lines = w.stdout().trimEnd().split("\n");
    for (const line of lines) {
      const event = JSON.parse(line) as { seq: number; type: string; payload: unknown };
      assert.equal(event.type, "task.created");
      assert.ok(Number.isInteger(event.seq));
      assert.ok(event.payload);
    }
  }));

test("un evento corrupto termina con 1 y nombra el evento", () =>
  withDaemon(async (home) => {
    await newTask(home, "Uno");
    await newTask(home, "Dos");
    const db = openEventDatabase(paths(home).database);
    try {
      db.exec("DROP TRIGGER events_no_update");
      db.prepare("UPDATE events SET payload = '{}' WHERE seq = 2").run();
    } finally {
      db.close();
    }
    const r = await runCli(["watch", "--from-start", "--no-color"], home);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /#1 {2}task\.created/);
    assert.match(r.stderr, /^✗ El evento #2 del log no supera la verificación\./);
  }));

test("Ctrl+C (SIGINT) sale con 0 y sin nada en stderr", () =>
  withDaemon(async (home) => {
    const w = spawnCli(["watch"], home);
    await untilConnected(home, w);
    w.child.kill("SIGINT");
    assert.equal(await w.exit, 0);
    assert.equal(w.stderr(), "");
  }));

/** Un «daemon» falso que envía un evento con caracteres de control y cierra la conexión. */
async function withFakeDaemon(body: (home: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "togi-fake-"));
  const home = join(root, "home");
  const p = paths(home);
  mkdirSync(p.runDir, { recursive: true });
  writeFileSync(p.credentials, "tok\n");
  const event = {
    seq: 1,
    stream: "task:5",
    type: "task.cr\u001b[2Jeated",
    at: "2026-11-04T14:02:11Z",
    actor: { kind: "human", userId: "usr_\u001b[31mx\u0007" },
    payload: {},
  };
  const server = createServer((req, res) => {
    if (req.url === "/v1/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ lastSeq: 0 }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`id: 1\nevent: x\ndata: ${JSON.stringify(event)}\n\n`);
  });
  await new Promise<void>((ok) => server.listen(p.socket, ok));
  try {
    await body(home);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: justo lo que se comprueba
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;

test("los campos del evento no llevan caracteres de control a la terminal; si se corta, sale con 6", () =>
  withFakeDaemon(async (home) => {
    for (const flags of [[], ["--json"]]) {
      const r = await runCli(["watch", ...flags], home);
      assert.equal(r.code, 6, r.stderr);
      assert.ok(r.stdout.endsWith("\n") && r.stdout.length > 10, JSON.stringify(r.stdout));
      assert.doesNotMatch(r.stdout, CONTROL, flags.join(" "));
    }
    const r = await runCli(["watch"], home);
    assert.match(r.stdout, /#1 {2}\?\s+#5 {2}\?/);
  }));
