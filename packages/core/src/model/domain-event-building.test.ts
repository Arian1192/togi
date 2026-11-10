import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoredEvent } from "../ports/event-store.ts";
import { EVENT_TYPES, EventParseError, toDomainEvent } from "./domain-event.ts";

// Los eventos de la rebanada 3 (ADR-011): se leen tal cual si son válidos y se rechazan si no.

const sha = "a".repeat(40);
const blob = { hash: "hmac-sha256:abc", keyId: "key_1", dataClass: "task_text" };
const workspace = {
  workspaceId: "wsp_1",
  kind: "clone",
  ref: "/Users/x/.togi/workspaces/wsp_1",
  branch: "togi/7-exportar",
  baseSha: sha,
};
const gateRun = {
  gateRunId: "gr_1",
  cycle: 1,
  headSha: sha,
  gate: "plan_contract",
  status: "pass",
  summary: "El diff solo toca ficheros del plan.",
  evidence: null,
  durationMs: 12,
};

const stored = (type: string, payload: unknown): StoredEvent => ({
  seq: 9,
  stream: "task:7",
  streamVersion: 3,
  type,
  schemaVersion: 1,
  actor: { kind: "system", component: "gates" },
  at: "2026-11-10T10:00:00Z",
  payload,
  prevHash: "p",
  hash: "h",
});
const accepts = (type: string, payload: unknown) =>
  assert.deepEqual(toDomainEvent(stored(type, payload)).payload, payload);
const rejects = (type: string, payload: unknown) =>
  assert.throws(
    () => toDomainEvent(stored(type, payload)),
    (e) => e instanceof EventParseError && e.seq === 9,
  );

test("los siete eventos de la rebanada 3 son tipos conocidos", () => {
  for (const type of [
    "workspace.created",
    "build.submitted",
    "gate.completed",
    "verification.completed",
    "task.failed",
    "failure.classified",
    "workspace.released",
  ]) {
    assert.ok(EVENT_TYPES.includes(type), type);
  }
});

test("la copia de trabajo es un clon de togi, sobre un commit de git", () => {
  accepts("workspace.created", workspace);
  rejects("workspace.created", { ...workspace, kind: "worktree" });
  rejects("workspace.created", { ...workspace, baseSha: "main" });
  rejects("workspace.created", { ...workspace, workspaceId: "w1" });
  accepts("workspace.released", { workspaceId: "wsp_1" });
});

test("la entrega del builder lleva su ciclo y su commit", () => {
  accepts("build.submitted", { cycle: 1, headSha: sha });
  accepts("build.submitted", { cycle: 2, headSha: "b".repeat(64) });
  rejects("build.submitted", { cycle: 0, headSha: sha });
  rejects("build.submitted", { cycle: 1, headSha: "HEAD" });
});

test("cada gate es uno de los del ADR y su estado, pasa, falla o error", () => {
  accepts("gate.completed", gateRun);
  accepts("gate.completed", { ...gateRun, gate: "protected_paths", status: "error" });
  rejects("gate.completed", { ...gateRun, gate: "install" });
  rejects("gate.completed", { ...gateRun, status: "skipped" });
  rejects("gate.completed", { ...gateRun, gateRunId: "1" });
});

test("el resumen de un gate es corto y sin caracteres de control: la salida va en la evidencia", () => {
  rejects("gate.completed", { ...gateRun, summary: "x".repeat(201) });
  rejects("gate.completed", { ...gateRun, summary: "línea\u001b[31m roja" });
  accepts("gate.completed", { ...gateRun, evidence: { ...blob, dataClass: "gate_evidence" } });
});

test("el cierre de la verificación, el fallo de la tarea y su clasificación", () => {
  accepts("verification.completed", { cycle: 3, headSha: sha, passed: false });
  accepts("task.failed", { cycle: 3, failedGates: ["gr_4", "gr_6"] });
  rejects("task.failed", { cycle: 3, failedGates: ["gate_4"] });
  accepts("failure.classified", { reason: { category: "scope", text: blob } });
  rejects("failure.classified", { reason: { category: "nada", text: blob } });
});
