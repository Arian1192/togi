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

/** Ejecuta una sesión cuyo agente escribe `stdout` y sale con `exitCode`; devuelve el resultado. */
async function resultOf(stdout: string, exitCode: number) {
  const input = new PassThrough();
  const output = new PassThrough();
  const raw: string[] = [];
  output.on("data", (d) => raw.push(String(d)));
  const finished = serve(input, output, {
    createSandbox: () => ({
      run: async () => ({ exitCode, stdout, stderr: "", timedOut: false }),
    }),
    env: {},
  });
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

const usage = (stop: string) => `${JSON.stringify({ kind: "usage", payload: { stop } })}\n`;

test("el motivo sale de usage.stop del agente", async () => {
  const reason = async (stop: string) => (await resultOf(usage(stop), 1)).failureReason;
  assert.equal(await reason("max_turns"), "max_turns_exceeded");
  assert.equal(await reason("max_budget"), "budget_exceeded");
  assert.equal(await reason("error"), "agent_failed");
});

test("sin usage, con una parada desconocida o con éxito, no hay motivo", async () => {
  assert.equal((await resultOf("", 1)).failureReason, undefined);
  assert.equal((await resultOf(usage("rara"), 1)).failureReason, undefined);
  const ok = await resultOf(usage("max_turns"), 0); // completó: no se inventa un motivo
  assert.deepEqual([ok.outcome, ok.failureReason], ["completed", undefined]);
});

test("si hay varios usage manda el último", async () => {
  const r = await resultOf(usage("max_turns") + usage("max_budget"), 1);
  assert.equal(r.failureReason, "budget_exceeded");
});
