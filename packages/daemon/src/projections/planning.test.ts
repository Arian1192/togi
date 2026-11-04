import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { type NewEvent, toDomainEvent } from "@togi/core";
import type Database from "better-sqlite3";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { applyProjections, rebuildProjections } from "./index.ts";

let dir: string;
let db: Database.Database;
let store: SqliteEventStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "togi-planning-"));
  db = openEventDatabase(join(dir, "togi.db"));
  store = new SqliteEventStore(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const human = { kind: "human", userId: "usr_1" } as const;
const agent = { kind: "agent", sessionId: "ses_1", role: "planner" } as const;
let clock = 0;
const ev = (type: string, payload: unknown, actor: NewEvent["actor"] = human): NewEvent => ({
  type,
  schemaVersion: 1,
  actor,
  at: new Date(Date.UTC(2026, 10, 4, 10, 0, clock++)).toISOString(),
  payload,
});
const ref = (name: string) => ({ hash: `hmac-sha256:${name}`, keyId: "k", dataClass: "task_text" });
const system = { kind: "system", component: "adapter:planner" } as const;

const created = () =>
  ev("task.created", {
    title: ref("t"),
    description: null,
    acceptanceCriteria: ref("c"),
    risk: "low",
    repo: "r",
    baseBranch: "main",
    source: { kind: "cli" },
  });
const started = (id: string) =>
  ev(
    "session.started",
    {
      sessionId: id,
      role: "planner",
      cycle: null,
      runtime: { id: "claude-agent-sdk", version: "1.0.0" },
      model: "m",
      specialist: { id: "generic-planner", version: 1, hash: "sha256:ab" },
      workspaceId: null,
      prompt: ref("p"),
      policy: ref("pol"),
    },
    system,
  );
const usage = { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.5, durationMs: 1000 };
const ended = (id: string, outcome: string) =>
  ev("session.ended", { sessionId: id, outcome, usage, trajectoryEvents: 3 }, system);
const proposed = (version: number, id: string) =>
  ev(
    "plan.proposed",
    {
      planVersion: version,
      sessionId: id,
      files: [{ path: "a.ts", change: "add" }],
      newTests: ["a.test.ts"],
      approach: ref("enfoque-secreto"),
      estimatedLines: { production: 100, tests: 200 },
      baseSha: "abc123",
    },
    { kind: "agent", sessionId: id as `ses_${string}`, role: "planner" },
  );
const decision = (verdict: string, planVersion: number) =>
  ev("decision.recorded", {
    gate: "plan",
    mode: "binding",
    subject: { planVersion },
    verdict,
    ...(verdict === "approve"
      ? {}
      : { reason: { category: "scope", text: ref("motivo-secreto") } }),
  });

const append = (stream: string, expected: number, events: NewEvent[]) =>
  store.appendWithin(stream, expected, events, (stored, tx) => {
    for (const s of stored) applyProjections(tx, toDomainEvent(s));
  });
const dump = () => ({
  tasks: db.prepare("SELECT * FROM tasks ORDER BY number").all(),
  plans: db.prepare("SELECT * FROM plans ORDER BY task_number, plan_version").all(),
  sessions: db.prepare("SELECT * FROM sessions ORDER BY session_id").all(),
  decisions: db.prepare("SELECT * FROM decisions ORDER BY seq").all(),
});

/** Plan v1, cambios pedidos, sesión 2 que falla y sesión 3 con el plan v2, aprobado. */
function seedPlanning() {
  append("task:1", 0, [created(), ev("task.submitted", {})]);
  append("task:1", 2, [started("ses_1"), proposed(1, "ses_1"), ended("ses_1", "completed")]);
  append("task:1", 5, [
    decision("request_changes", 1),
    started("ses_2"),
    ended("ses_2", "timeout"),
  ]);
  append("task:1", 8, [started("ses_3"), proposed(2, "ses_3"), ended("ses_3", "completed")]);
  append("task:1", 11, [decision("approve", 2)]);
}

test("plans: una fila por versión, con la referencia del enfoque y sin su texto", () => {
  seedPlanning();
  const { plans } = dump() as { plans: Record<string, unknown>[] };
  assert.deepEqual(
    plans.map((p) => [p.plan_version, p.session_id]),
    [
      [1, "ses_1"],
      [2, "ses_3"],
    ],
  );
  assert.deepEqual(plans[0], {
    task_number: 1,
    plan_version: 1,
    session_id: "ses_1",
    base_sha: "abc123",
    files: '[{"path":"a.ts","change":"add"}]',
    new_tests: '["a.test.ts"]',
    approach: JSON.stringify(ref("enfoque-secreto")),
    estimated_production: 100,
    estimated_tests: 200,
    proposed_at: plans[0]?.proposed_at,
  });
});

test("sessions: estado, resultado y uso de cada sesión, también las fallidas", () => {
  seedPlanning();
  const rows = db
    .prepare(
      "SELECT session_id, state, outcome, usage, runtime, specialist FROM sessions ORDER BY 1",
    )
    .all() as Record<string, string>[];
  assert.deepEqual(
    rows.map((r) => [r.session_id, r.state, r.outcome]),
    [
      ["ses_1", "ended", "completed"],
      ["ses_2", "ended", "timeout"],
      ["ses_3", "ended", "completed"],
    ],
  );
  assert.deepEqual(JSON.parse(rows[0]?.usage ?? ""), usage);
  assert.equal(rows[0]?.runtime, "claude-agent-sdk@1.0.0");
  assert.equal(rows[0]?.specialist, "generic-planner@1");
});

test("una sesión sin terminar queda active, sin fin ni resultado", () => {
  append("task:1", 0, [created(), ev("task.submitted", {}), started("ses_1")]);
  const row = db.prepare("SELECT state, ended_at, outcome, usage FROM sessions").get();
  assert.deepEqual(row, { state: "active", ended_at: null, outcome: null, usage: null });
});

test("decisions: el actor es solo el id seudónimo y el motivo solo una referencia", () => {
  seedPlanning();
  const rows = db.prepare("SELECT * FROM decisions ORDER BY seq").all() as Record<
    string,
    unknown
  >[];
  assert.deepEqual(
    rows.map((r) => [r.verdict, r.plan_version, r.actor, r.gate]),
    [
      ["request_changes", 1, "usr_1", "plan"],
      ["approve", 2, "usr_1", "plan"],
    ],
  );
  assert.deepEqual(JSON.parse(String(rows[0]?.reason)), {
    category: "scope",
    text: ref("motivo-secreto"),
  });
  assert.equal(rows[1]?.reason, null);
});

test("tasks sigue el flujo del plan hasta building", () => {
  seedPlanning();
  assert.equal((dump().tasks[0] as { state: string }).state, "building");
});

test("rebuildProjections da lo mismo que la aplicación incremental", () => {
  seedPlanning();
  append("task:2", 0, [created(), ev("task.submitted", {}), started("ses_9")]);
  const incremental = dump();
  for (const batchSize of [1, 3, 500]) {
    rebuildProjections(db, store, batchSize);
    assert.deepEqual(dump(), incremental, `lote ${batchSize}`);
  }
});

test("una sesión que termina sin haber empezado lanza y no deja nada", () => {
  append("task:1", 0, [created(), ev("task.submitted", {})]);
  assert.throws(() => append("task:1", 2, [ended("ses_x", "failed")]), /sin sesión ses_x/);
  assert.deepEqual(dump().sessions, []);
});

test("un evento de agente no cambia quién decide: el actor agente se guarda por su sesión", () => {
  append("task:1", 0, [created(), ev("task.submitted", {})]);
  append("task:1", 2, [
    ev(
      "decision.recorded",
      {
        gate: "plan",
        mode: "binding",
        subject: { planVersion: 1 },
        verdict: "approve",
      },
      agent,
    ),
  ]);
  assert.equal(
    (db.prepare("SELECT actor FROM decisions").get() as { actor: string }).actor,
    "ses_1",
  );
});
