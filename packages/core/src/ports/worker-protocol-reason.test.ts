import assert from "node:assert/strict";
import { test } from "node:test";
import { FromWorker } from "./worker-protocol.ts";

const result = {
  type: "result",
  sessionId: "ses_1",
  outcome: "failed",
  exitCode: 1,
  durationMs: 5,
};

test("el resultado admite un motivo opcional, también uno que no está en la lista", () => {
  assert.equal(FromWorker.safeParse(result).success, true);
  assert.equal(FromWorker.safeParse({ ...result, failureReason: "budget_exceeded" }).success, true);
  // No se rechaza el mensaje entero: el daemon lo normaliza a agent_failed.
  assert.equal(FromWorker.safeParse({ ...result, failureReason: "inventado" }).success, true);
});

test("un motivo que no es texto invalida el resultado", () => {
  assert.equal(FromWorker.safeParse({ ...result, failureReason: 3 }).success, false);
  assert.equal(FromWorker.safeParse({ ...result, failureReason: null }).success, false);
});
