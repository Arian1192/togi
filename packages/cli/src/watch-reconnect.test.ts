import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { paths } from "@togi/daemon/config";
import { startDaemon } from "../../daemon/src/start.ts";
import { createClient } from "./client.ts";
import type { CliError } from "./errors.ts";
import { reconnectingStream } from "./event-stream.ts";
import { runCli } from "./testing/run-cli.ts";
import { spawnCli } from "./testing/spawn-cli.ts";

const seqs = (out: string): number[] =>
  out
    .trimEnd()
    .split("\n")
    .map((l) => Number(/#(\d+)/.exec(l)?.[1]));

async function newTask(home: string, title: string): Promise<void> {
  const r = await runCli(["task", "new", title, "--risk", "low", "--repo", "o/r"], home);
  assert.equal(r.code, 0, r.stderr);
}

test("tras reiniciar el daemon, watch sigue sin huecos ni repetidos", async () => {
  const root = mkdtempSync(join(tmpdir(), "togi-reconnect-"));
  const home = join(root, "home");
  let daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
  const w = spawnCli(["watch", "--from-start"], home);
  try {
    await newTask(home, "Uno");
    await newTask(home, "Dos");
    const until = async (n: number) => {
      const deadline = Date.now() + 15_000;
      while (w.stdout().split("\n").length <= n) {
        assert.ok(Date.now() < deadline, `faltan líneas: ${w.stdout()} ${w.stderr()}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    await until(2);
    await daemon.close();
    daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
    await newTask(home, "Tres");
    await newTask(home, "Cuatro");
    await until(4);
    w.child.kill("SIGINT");
    assert.equal(await w.exit, 0, w.stderr());
    assert.deepEqual(seqs(w.stdout()), [1, 2, 3, 4]);
  } finally {
    w.child.kill("SIGKILL");
    await daemon.close();
    rmSync(root, { recursive: true, force: true });
  }
});

const ev = (seq: number) =>
  `id: ${seq}\nevent: task.created\ndata: ${JSON.stringify({
    seq,
    stream: `task:${seq}`,
    type: "task.created",
    at: "2026-11-04T14:02:11Z",
    actor: { kind: "system", component: "x" },
  })}\n\n`;

test("reconecta con Last-Event-ID, descarta seq ya vistos y se rinde con 6 sin daemon", async () => {
  const root = mkdtempSync(join(tmpdir(), "togi-fake-"));
  const home = join(root, "home");
  const p = paths(home);
  mkdirSync(p.runDir, { recursive: true });
  writeFileSync(p.credentials, "tok\n");
  const ids: unknown[] = [];
  const server = createServer((req, res) => {
    ids.push(req.headers["last-event-id"]);
    res.writeHead(200, { "content-type": "text/event-stream" });
    // El segundo intento repite el 2 (como si ignorara Last-Event-ID).
    res.end(ids.length === 1 ? ev(1) + ev(2) : ev(2) + ev(3));
  });
  await new Promise<void>((ok) => server.listen(p.socket, ok));
  const got: number[] = [];
  const timing = { initialMs: 10, maxMs: 40, giveUpMs: 300 };
  try {
    const stream = reconnectingStream(
      createClient(home),
      undefined,
      new AbortController().signal,
      timing,
    );
    const error = await (async () => {
      for await (const e of stream) {
        got.push(e.seq);
        if (e.seq === 3) {
          server.closeAllConnections();
          await new Promise((ok) => server.close(ok));
        }
      }
    })().catch((e: CliError) => e);
    assert.deepEqual(got, [1, 2, 3]);
    assert.equal(ids[0], undefined);
    assert.equal(ids[1], "2");
    assert.equal((error as CliError).exitCode, 6);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
