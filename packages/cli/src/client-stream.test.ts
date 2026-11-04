import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { socketFetch } from "./client.ts";

test("socketFetch entrega la respuesta según llega, sin esperar a que termine", async () => {
  const dir = mkdtempSync(join(tmpdir(), "togi-stream-"));
  const socket = join(dir, "s.sock");
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("primero\n"); // la respuesta no se cierra nunca: es un stream que no termina
  });
  await new Promise<void>((ok) => server.listen(socket, ok));
  try {
    const res = await socketFetch(socket, "tok", "req-1")("http://togi/v1/events");
    assert.equal(res.status, 200);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    assert.equal(new TextDecoder().decode(first.value), "primero\n");
    await reader.cancel();
  } finally {
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("si el servidor corta la conexión a mitad de respuesta, la lectura falla", async () => {
  const dir = mkdtempSync(join(tmpdir(), "togi-stream-"));
  const socket = join(dir, "s.sock");
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("parcial\n");
    setTimeout(() => res.destroy(), 20);
  });
  await new Promise<void>((ok) => server.listen(socket, ok));
  try {
    const res = await socketFetch(socket, "tok", "req-2")("http://togi/v1/events");
    await assert.rejects(res.text());
  } finally {
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
