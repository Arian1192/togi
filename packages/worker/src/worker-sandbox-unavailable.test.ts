import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import type { FromWorker, SessionOrder } from "@togi/core";
import { serve } from "./worker.ts";

const order = {
  type: "session",
  sessionId: "ses_1",
  spec: {
    readPaths: [],
    writeDir: "/w/scratch",
    allowedDomains: [],
    allowedEnv: [],
    credentials: [],
    timeoutMs: 1000,
  },
  workspacesRoot: "/w",
  runtimePaths: [],
  argv: ["agent"],
  credential: null,
} satisfies SessionOrder;

async function result(run: () => Promise<never>) {
  const input = new PassThrough();
  const output = new PassThrough();
  const raw: string[] = [];
  output.on("data", (d) => raw.push(String(d)));
  const finished = serve(input, output, { createSandbox: () => ({ run }), env: {} });
  input.write(`${JSON.stringify(order)}\n`);
  while (!raw.join("").includes('"type":"result"')) await new Promise((r) => setTimeout(r, 5));
  input.end();
  await finished;
  const messages = raw
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as FromWorker);
  return messages.find((m) => m.type === "result") as Extract<FromWorker, { type: "result" }>;
}

test("si el sandbox lanza (no pudo arrancar), el resultado es failed con sandbox_unavailable", async () => {
  const r = await result(async () => {
    throw new Error("srt no está soportado en esta plataforma");
  });
  assert.deepEqual(
    [r.outcome, r.failureReason, r.exitCode],
    ["failed", "sandbox_unavailable", null],
  );
});

test("el mensaje del error no sale del trabajador", async () => {
  const r = await result(async () => {
    throw new Error("detalle secreto");
  });
  assert.ok(!JSON.stringify(r).includes("detalle secreto"));
});
