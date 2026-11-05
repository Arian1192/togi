import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import type { SessionOrder } from "@togi/core";
import type { AgentEventStore } from "../trajectory/agent-event-store.ts";
import { createWorkerLauncher } from "./worker-launcher.ts";

const order = (mode: string, input = "respuesta final"): SessionOrder => ({
  type: "session",
  sessionId: "ses_1",
  spec: {
    readPaths: [],
    writeDir: "/tmp",
    allowedDomains: [],
    allowedEnv: [],
    credentials: [],
    timeoutMs: 10_000,
  },
  workspacesRoot: "/tmp",
  runtimePaths: [],
  argv: [mode],
  input,
  credential: null,
});
const agentEvents = { append: async () => ({}) } as unknown as AgentEventStore;
const launcher = createWorkerLauncher({
  agentEvents,
  workerEntry: join(import.meta.dirname, "testing", "fake-agent-worker.ts"),
  graceMs: 300,
});

test("el uso es la suma de los eventos usage y el texto final, el último mensaje", async () => {
  const r = await launcher.run(order("plan"), 1);
  assert.equal(r.outcome, "completed");
  assert.equal(r.finalText, "respuesta final");
  assert.equal(r.trajectoryEvents, 4);
  assert.deepEqual(
    [r.usage.inputTokens, r.usage.outputTokens, r.usage.estimatedCostUsd],
    [200, 100, 0.75],
  );
  assert.ok(r.usage.durationMs >= 0);
});

test("un motivo de la lista llega tal cual", async () => {
  for (const code of ["max_turns_exceeded", "budget_exceeded", "agent_failed"] as const) {
    const r = await launcher.run(order(`fail:${code}`), 1);
    assert.deepEqual([r.outcome, r.failureReason], ["failed", code]);
  }
});

test("un código fuera de la lista, o vacío, se trata como agent_failed", async () => {
  for (const mode of ["fail:inventado", "fail:", "fail:../../etc/passwd"]) {
    const r = await launcher.run(order(mode), 1);
    assert.deepEqual([r.outcome, r.failureReason], ["failed", "agent_failed"]);
  }
});

test("un trabajador que muere sin resultado sigue siendo worker_died, con uso a cero", async () => {
  const r = await launcher.run(order("die"), 1);
  assert.equal(r.failureReason, "worker_died");
  assert.equal(r.finalText, null);
  assert.equal(r.usage.estimatedCostUsd, 0);
});
