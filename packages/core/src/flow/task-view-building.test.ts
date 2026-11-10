import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_BUILDING } from "../model/building.ts";
import { evolve, type NewTaskEvent, type TaskView } from "./task-view.ts";

// Cómo mueven la vista de la tarea los eventos de la rebanada 3 (ADR-001, ADR-011).

const sha = "a".repeat(40);
const sha2 = "b".repeat(40);
const blob = { hash: "hmac-sha256:x", keyId: "key_1", dataClass: "task_text" } as const;
const system = { kind: "system", component: "gates" } as const;
const ev = (type: string, payload: unknown): NewTaskEvent =>
  ({ schemaVersion: 1, actor: system, at: "2026-11-10T10:00:00Z", type, payload }) as NewTaskEvent;
const building: TaskView = {
  exists: true,
  state: "building",
  title: blob,
  description: null,
  acceptanceCriteria: blob,
  risk: "low",
};
const play = (view: TaskView, ...events: NewTaskEvent[]) => events.reduce(evolve, view);
const gate = (name: string, status: string, n: number, headSha = sha) =>
  ev("gate.completed", {
    gateRunId: `gr_${n}`,
    cycle: 1,
    headSha,
    gate: name,
    status,
    summary: "s",
    evidence: null,
    durationMs: 1,
  });

test("una tarea recién aprobada está en el ciclo 1, sin copia de trabajo, sin añadir nada a la vista", () => {
  assert.equal(building.exists && building.building, undefined);
  assert.deepEqual(NO_BUILDING, { cycle: 1, workspaceId: null, headSha: null, gates: {} });
});

test("la copia de trabajo queda en la vista; la entrega pasa a verifying con su commit", () => {
  const v = play(
    building,
    ev("workspace.created", {
      workspaceId: "wsp_1",
      kind: "clone",
      ref: "/r",
      branch: "togi/7-x",
      baseSha: sha,
    }),
    ev("build.submitted", { cycle: 1, headSha: sha2 }),
  );
  assert.ok(v.exists);
  assert.equal(v.state, "verifying");
  assert.deepEqual(v.building, { cycle: 1, workspaceId: "wsp_1", headSha: sha2, gates: {} });
});

test("cada gate deja su resultado; una entrega nueva los borra", () => {
  const v = play(
    building,
    ev("build.submitted", { cycle: 1, headSha: sha }),
    gate("plan_contract", "pass", 1),
    gate("test", "fail", 2),
  );
  assert.ok(v.exists);
  assert.deepEqual(v.building?.gates, {
    plan_contract: { gateRunId: "gr_1", status: "pass" },
    test: { gateRunId: "gr_2", status: "fail" },
  });
  const again = play(v, ev("build.submitted", { cycle: 1, headSha: sha2 }));
  assert.ok(again.exists);
  assert.deepEqual(again.building?.gates, {});
});

test("verificación en verde: a review; en rojo: a building con el ciclo siguiente y sin gates", () => {
  const verifying = play(building, ev("build.submitted", { cycle: 1, headSha: sha }));
  const ok = play(
    verifying,
    ev("verification.completed", { cycle: 1, headSha: sha, passed: true }),
  );
  assert.ok(ok.exists && ok.state === "review");
  const ko = play(
    verifying,
    gate("test", "fail", 3),
    ev("verification.completed", { cycle: 1, headSha: sha, passed: false }),
  );
  assert.ok(ko.exists);
  assert.equal(ko.state, "building");
  assert.deepEqual(ko.building, { cycle: 2, workspaceId: null, headSha: null, gates: {} });
});

test("task.failed cierra la tarea; la clasificación y la liberación de la copia quedan anotadas", () => {
  const v = play(
    building,
    ev("task.failed", { cycle: 3, failedGates: ["gr_9"] }),
    ev("failure.classified", { reason: { category: "scope", text: blob } }),
    ev("workspace.released", { workspaceId: "wsp_1" }),
  );
  assert.ok(v.exists);
  assert.equal(v.state, "failed");
  assert.equal(v.building?.failureClassified, true);
  assert.equal(v.building?.workspaceReleased, true);
});
