import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSse, type SseMessage } from "./sse.ts";

/** Un `ReadableStream` que entrega cada trozo por separado, como la red. */
function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<SseMessage[]> {
  const out: SseMessage[] = [];
  for await (const message of parseSse(body)) out.push(message);
  return out;
}

test("un mensaje con id, event y data", async () => {
  const out = await collect(streamOf('id: 7\nevent: task.created\ndata: {"a":1}\n\n'));
  assert.deepEqual(out, [{ id: "7", event: "task.created", data: '{"a":1}' }]);
});

test("los trozos partidos a mitad de línea, de campo o de carácter se recomponen", async () => {
  const bytes = new TextEncoder().encode("id: 1\nevent: x\ndata: ñ\n\n");
  const half = bytes.indexOf(0xc3) + 1; // parte la «ñ» en dos bytes
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 4));
      controller.enqueue(bytes.slice(4, half));
      controller.enqueue(bytes.slice(half));
      controller.close();
    },
  });
  assert.deepEqual(await collect(body), [{ id: "1", event: "x", data: "ñ" }]);
});

test("los comentarios (latido) se ignoran y no producen mensaje", async () => {
  const out = await collect(streamOf(": ping\n\nid: 2\nevent: e\ndata: d\n\n: ping\n\n"));
  assert.deepEqual(out, [{ id: "2", event: "e", data: "d" }]);
});

test("acepta \\r\\n y varias líneas data se unen con salto de línea", async () => {
  const out = await collect(streamOf("id: 3\r\nevent: e\r\ndata: a\r\ndata: b\r\n\r\n"));
  assert.deepEqual(out, [{ id: "3", event: "e", data: "a\nb" }]);
});

test("un mensaje sin id (event: error) llega sin id, y varios se entregan en orden", async () => {
  const out = await collect(
    streamOf("id: 1\nevent: a\ndata: x\n\n", 'event: error\ndata: {"code":"integrity_error"}\n\n'),
  );
  assert.deepEqual(out, [
    { id: "1", event: "a", data: "x" },
    { id: undefined, event: "error", data: '{"code":"integrity_error"}' },
  ]);
});

test("un mensaje sin terminar al cerrarse el stream no se entrega", async () => {
  assert.deepEqual(await collect(streamOf("id: 1\nevent: a\ndata: x\n")), []);
});
