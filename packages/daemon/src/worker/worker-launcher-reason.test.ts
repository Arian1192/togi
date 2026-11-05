import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import type { SessionOrder } from "@togi/core";
import type { AgentEventStore } from "../trajectory/agent-event-store.ts";
import { createWorkerLauncher } from "./worker-launcher.ts";

const entry = (name: string) => join(import.meta.dirname, "testing", name);
const order = (mode: string, timeoutMs = 10_000): SessionOrder => ({
  type: "session",
  sessionId: "ses_1",
  spec: {
    readPaths: [],
    writeDir: "/tmp",
    allowedDomains: [],
    allowedEnv: [],
    credentials: [],
    timeoutMs,
  },
  workspacesRoot: "/tmp",
  runtimePaths: [],
  argv: [mode],
  credential: null,
});
const store = (append: () => Promise<unknown>) => ({ append }) as unknown as AgentEventStore;
const ok = store(async () => ({}));
const launcher = (agentEvents: AgentEventStore, worker = "fake-worker.ts") =>
  createWorkerLauncher({ agentEvents, workerEntry: entry(worker), graceMs: 300 });

test("una sesión completada no lleva motivo", async () => {
  const r = await launcher(ok).run(order("complete"), 1);
  assert.deepEqual([r.outcome, r.failureReason], ["completed", null]);
});

test("el tope de tiempo da timeout con motivo timeout", async () => {
  const r = await launcher(ok).run(order("hang", 300), 1);
  assert.deepEqual([r.outcome, r.failureReason], ["timeout", "timeout"]);
});

test("un trabajador que muere sin resultado da failed con worker_died", async () => {
  const r = await launcher(ok).run(order("die"), 1);
  assert.deepEqual([r.outcome, r.failureReason], ["failed", "worker_died"]);
});

test("un agente que termina con error da failed con agent_failed", async () => {
  const r = await launcher(ok, "fake-failing-worker.ts").run(order("x"), 1);
  assert.deepEqual([r.outcome, r.failureReason], ["failed", "agent_failed"]);
});

test("si no se puede escribir la trayectoria, failed con trajectory_write_failed", async () => {
  const broken = store(async () => {
    throw new Error("disco lleno en /Users/ana");
  });
  const r = await launcher(broken).run(order("complete"), 1);
  assert.deepEqual([r.outcome, r.failureReason], ["failed", "trajectory_write_failed"]);
  assert.equal(r.trajectoryEvents, 0);
});

test("la cancelación no lleva motivo", async () => {
  const abort = new AbortController();
  setTimeout(() => abort.abort(), 300);
  const r = await launcher(ok).run(order("wait"), 1, abort.signal);
  assert.deepEqual([r.outcome, r.failureReason], ["cancelled", null]);
});
