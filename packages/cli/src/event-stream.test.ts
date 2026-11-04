import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { paths } from "@togi/daemon/config";
import { startDaemon } from "../../daemon/src/start.ts";
import { openEventDatabase } from "../../daemon/src/store/database.ts";
import { createClient } from "./client.ts";
import type { CliError } from "./errors.ts";
import { eventStream, lastSeq } from "./event-stream.ts";
import { runCli } from "./testing/run-cli.ts";

async function newTask(home: string, title: string): Promise<void> {
  const r = await runCli(["task", "new", title, "--risk", "low", "--repo", "o/r"], home);
  assert.equal(r.code, 0, r.stderr);
}

async function withDaemon(body: (home: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "togi-stream-"));
  const home = join(root, "home");
  const daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
  try {
    await body(home);
  } finally {
    await daemon.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test("lo escrito entre consultar health y conectar no se pierde", () =>
  withDaemon(async (home) => {
    await newTask(home, "Antes");
    const client = createClient(home);
    const seq = await lastSeq(client);
    await newTask(home, "Entre health y conexión");
    const abort = new AbortController();
    const first = await eventStream(client, seq, abort.signal).next();
    abort.abort();
    assert.equal(first.value?.seq, seq + 1);
    assert.equal(first.value?.type, "task.created");
  }));

test("un evento corrupto lanza el error de integridad con su seq y sale con 1", () =>
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
    const stream = eventStream(createClient(home), undefined, new AbortController().signal);
    assert.equal((await stream.next()).value?.seq, 1);
    const error = await stream.next().catch((e: CliError) => e);
    assert.equal((error as CliError).code, "integrity_error");
    assert.equal((error as CliError).exitCode, 1);
    assert.equal((error as CliError).context.event, 2);
  }));

test("abortar mientras espera eventos termina el stream sin error", () =>
  withDaemon(async (home) => {
    await newTask(home, "Antes");
    const client = createClient(home);
    const abort = new AbortController();
    const stream = eventStream(client, await lastSeq(client), abort.signal);
    const pending = stream.next();
    setTimeout(() => abort.abort(), 100);
    assert.equal((await pending).done, true);
  }));

/** Un «daemon» falso que responde al SSE con `sse` y cierra la conexión. */
async function withFakeDaemon(sse: string, body: (home: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "togi-fake-"));
  const home = join(root, "home");
  const p = paths(home);
  mkdirSync(p.runDir, { recursive: true });
  writeFileSync(p.credentials, "tok\n");
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(sse);
  });
  await new Promise<void>((ok) => server.listen(p.socket, ok));
  try {
    await body(home);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
}

const drain = async (home: string): Promise<CliError> => {
  const stream = eventStream(createClient(home), undefined, new AbortController().signal);
  for (;;) await stream.next();
};

test("si la conexión se corta, lanza «daemon no disponible» (6)", () =>
  withFakeDaemon(": ping\n\n", async (home) => {
    const error = await drain(home).catch((e: CliError) => e);
    assert.equal(error.code, "daemon_unavailable");
    assert.equal(error.exitCode, 6);
  }));

test("un evento con datos que no son un evento lanza integrity_error (1)", () =>
  withFakeDaemon("id: 9\nevent: x\ndata: no-es-json\n\n", async (home) => {
    const error = await drain(home).catch((e: CliError) => e);
    assert.equal(error.code, "integrity_error");
    assert.equal(error.exitCode, 1);
    assert.equal(error.context.event, 9);
  }));

test("un event: error del daemon lanza integrity_error con el seq indicado", () =>
  withFakeDaemon('event: error\ndata: {"code":"integrity_error","seq":4}\n\n', async (home) => {
    const error = await drain(home).catch((e: CliError) => e);
    assert.equal(error.code, "integrity_error");
    assert.equal(error.context.event, 4);
  }));
