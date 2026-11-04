import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { NewEvent } from "@togi/core";
import Database from "better-sqlite3";
import { openEventDatabase } from "./database.ts";
import { SqliteEventStore } from "./event-store.ts";
import { MIGRATIONS, SCHEMA_V1_SQL, SCHEMA_VERSION } from "./schema.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "togi-mig9-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const actor = { kind: "human", userId: "usr_1" } as const;
const system = { kind: "system", component: "adapter:planner" } as const;
let clock = 0;
const ev = (type: string, payload: unknown, who: NewEvent["actor"] = actor): NewEvent => ({
  type,
  schemaVersion: 1,
  actor: who,
  at: new Date(Date.UTC(2026, 10, 4, 10, 0, clock++)).toISOString(),
  payload,
});
const ref = (name: string) => ({ hash: `hmac-sha256:${name}`, keyId: "k", dataClass: "task_text" });

/** Una base en versión 8 cuyo log ya tiene una tarea con una sesión, un plan y una decisión. */
async function seedV8() {
  const path = join(dir, "togi.db");
  const old = new Database(path);
  old.exec(SCHEMA_V1_SQL);
  for (let v = 2; v <= 8; v++) old.exec(MIGRATIONS[v] as string);
  old.pragma("user_version = 8");
  const store = new SqliteEventStore(old);
  await store.append("task:1", 0, [
    ev("task.created", {
      title: ref("t"),
      description: null,
      acceptanceCriteria: ref("c"),
      risk: "low",
      repo: "o/r",
      baseBranch: "main",
      source: { kind: "cli" },
    }),
    ev("task.submitted", {}),
    ev(
      "session.started",
      {
        sessionId: "ses_1",
        role: "planner",
        cycle: null,
        runtime: { id: "sdk", version: "1" },
        model: "m",
        specialist: { id: "generic-planner", version: 1, hash: "sha256:ab" },
        workspaceId: null,
        prompt: ref("p"),
        policy: ref("pol"),
      },
      system,
    ),
    ev(
      "plan.proposed",
      {
        planVersion: 1,
        sessionId: "ses_1",
        files: [],
        newTests: [],
        approach: ref("a"),
        estimatedLines: { production: 10, tests: 20 },
        baseSha: "abc",
      },
      { kind: "agent", sessionId: "ses_1", role: "planner" },
    ),
    ev("decision.recorded", {
      gate: "plan",
      mode: "binding",
      subject: { planVersion: 1 },
      verdict: "approve",
    }),
  ]);
  old.close();
  return path;
}

test("una base en versión 8 migra, conserva los eventos y reconstruye las proyecciones", async () => {
  const path = await seedV8();
  const db = openEventDatabase(path);
  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  assert.equal((db.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n, 5);
  assert.deepEqual(db.prepare("SELECT number, state FROM tasks").all(), [
    { number: 1, state: "building" },
  ]);
  assert.deepEqual(db.prepare("SELECT task_number, plan_version FROM plans").all(), [
    { task_number: 1, plan_version: 1 },
  ]);
  assert.deepEqual(db.prepare("SELECT session_id, state FROM sessions").all(), [
    { session_id: "ses_1", state: "active" },
  ]);
  assert.deepEqual(db.prepare("SELECT verdict, actor FROM decisions").all(), [
    { verdict: "approve", actor: "usr_1" },
  ]);
  db.close();
});

test("una base nueva tiene las tres tablas vacías", () => {
  const db = openEventDatabase(join(dir, "new.db"));
  for (const t of ["plans", "sessions", "decisions"]) {
    assert.equal((db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n, 0);
  }
  db.close();
});
