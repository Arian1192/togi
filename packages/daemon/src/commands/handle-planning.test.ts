import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { Actor, DomainError, StoredEvent } from "@togi/core";
import type Database from "better-sqlite3";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { paths } from "../config/app.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { type CommandInput, type CreateTaskInput, createHandler } from "./handle-command.ts";

let home: string;
let db: Database.Database;
let store: SqliteEventStore;
let blobs: FileBlobStore;
const human: Actor = { kind: "human", userId: "usr_1" };
const system: Actor = { kind: "system", component: "adapter:planner" };
const agent: Actor = { kind: "agent", sessionId: "ses_1", role: "planner" };
const clock = () => new Date("2026-11-04T10:00:00Z");
const task: CreateTaskInput = {
  type: "create",
  title: "Filtro",
  description: "d",
  acceptanceCriteria: "criterio",
  risk: "low",
  repo: "r",
  baseBranch: "main",
  source: { kind: "cli" },
};
const usage = { inputTokens: 1, outputTokens: 2, estimatedCostUsd: 0.1, durationMs: 5 };
const start: CommandInput = {
  type: "startSession",
  number: 1,
  session: {
    sessionId: "ses_1",
    role: "planner",
    cycle: null,
    runtime: { id: "fake", version: "1" },
    model: "m",
    specialist: { id: "generic-planner", version: 1, hash: "sha256:abc" },
    workspaceId: null,
    prompt: "el prompt",
    policy: "la política",
  },
};
const propose = (approach = "el enfoque", production = 10): CommandInput => ({
  type: "proposePlan",
  number: 1,
  plan: {
    files: [{ path: "src/a.ts", change: "modify" }],
    newTests: ["src/a.test.ts"],
    approach,
    estimatedLines: { production, tests: 20 },
    baseSha: "abc123",
  },
});
const end: CommandInput = {
  type: "endSession",
  number: 1,
  session: { sessionId: "ses_1", outcome: "completed", usage, trajectoryEvents: 0 },
};
const handle = () => createHandler({ db, store, blobs, clock });
const ok = (r: unknown): StoredEvent[] => {
  assert.ok(r && typeof r === "object" && "events" in r, JSON.stringify(r));
  return r.events as StoredEvent[];
};
const payload = (e: StoredEvent | undefined) => e?.payload as Record<string, never>;
const state = () =>
  (db.prepare("SELECT state FROM tasks WHERE number = 1").get() as { state: string }).state;

/** Tarea 1 enviada, con sesión iniciada y plan v1 propuesto. */
async function inReview(h = handle()) {
  ok(await h(human, task));
  ok(await h(human, { type: "submit", number: 1 }));
  ok(await h(system, start));
  ok(await h(agent, propose()));
  ok(await h(system, end));
  return h;
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-plan-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  store = new SqliteEventStore(db);
  const keys = new DataKeyring(
    db,
    await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } })),
  );
  blobs = new FileBlobStore(p.blobs, keys);
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

test("startSession guarda el prompt y la política como blobs prompt", async () => {
  const h = handle();
  ok(await h(human, task));
  ok(await h(human, { type: "submit", number: 1 }));
  const [event] = ok(await h(system, start));
  const { prompt, policy } = payload(event) as unknown as Record<
    string,
    Parameters<typeof blobs.get>[0]
  >;
  assert.equal(prompt?.dataClass, "prompt");
  assert.equal(policy?.dataClass, "prompt");
  assert.equal(await h.readText(prompt as never), "el prompt");
  assert.equal(await h.readText(policy as never), "la política");
});

test("proposePlan guarda el enfoque como blob task_text y la proyección no lo contiene", async () => {
  await inReview();
  const row = db.prepare("SELECT * FROM plans WHERE task_number = 1").get() as Record<
    string,
    unknown
  >;
  assert.equal(row.plan_version, 1);
  assert.doesNotMatch(JSON.stringify(row), /el enfoque/);
  const ref = JSON.parse(row.approach as string);
  assert.equal(ref.dataClass, "task_text");
  assert.equal(await handle().readText(ref), "el enfoque");
  assert.equal(state(), "plan_review");
});

test("el ciclo completo: pedir cambios con motivo, nueva versión y aprobar", async () => {
  const h = await inReview();
  const changes = ok(
    await h(human, {
      type: "requestPlanChanges",
      number: 1,
      planVersion: 1,
      category: "scope",
      text: "demasiado grande",
    }),
  );
  const reason = payload(changes[0]).reason as unknown as { text: never; category: string };
  assert.equal(await h.readText(reason.text), "demasiado grande");
  assert.equal(state(), "planning");
  ok(await h(system, { ...start, session: { ...start.session, sessionId: "ses_2" } } as never));
  ok(await h({ ...agent, sessionId: "ses_2" } as Actor, propose("v2")));
  ok(await h(system, { ...end, session: { ...end.session, sessionId: "ses_2" } } as never));
  ok(await h(human, { type: "approvePlan", number: 1, planVersion: 2 }));
  assert.equal(state(), "building");
  assert.equal((db.prepare("SELECT count(*) n FROM decisions").get() as { n: number }).n, 2);
});

test("rejectPlan con motivo vacío devuelve invalid_reason y no escribe", async () => {
  const h = await inReview();
  const before = store.currentVersion("task:1");
  const r = await h(human, {
    type: "rejectPlan",
    number: 1,
    planVersion: 1,
    category: "scope",
    text: "  ",
  });
  assert.equal((r as DomainError).code, "invalid_reason");
  assert.equal(store.currentVersion("task:1"), before);
});

test("approvePlan sobre un plan que pasa de los límites devuelve plan_exceeds_limits", async () => {
  const h = handle();
  ok(await h(human, task));
  ok(await h(human, { type: "submit", number: 1 }));
  ok(await h(system, start));
  ok(await h(agent, propose("grande", 300)));
  const r = await h(human, { type: "approvePlan", number: 1, planVersion: 1 });
  assert.equal((r as DomainError).code, "plan_exceeds_limits");
});

test("un agente no puede aprobar y un humano no puede proponer", async () => {
  const h = await inReview();
  const a = await h(agent, { type: "approvePlan", number: 1, planVersion: 1 });
  assert.equal((a as DomainError).code, "actor_not_allowed");
  const p = await h(human, propose());
  assert.equal((p as DomainError).code, "actor_not_allowed");
});

test("If-Match desfasado en un comando de plan: precondition_failed y nada escrito", async () => {
  const h = await inReview();
  const current = store.currentVersion("task:1");
  const r = await h(
    human,
    { type: "approvePlan", number: 1, planVersion: 1 },
    { ifMatch: current - 1 },
  );
  assert.deepEqual(r, { kind: "precondition_failed", current });
  assert.equal(store.currentVersion("task:1"), current);
});

test("sobre una tarea inexistente: task_not_found y ningún blob", async () => {
  const h = handle();
  const files = () =>
    existsSync(paths(home).blobs) ? readdirSync(paths(home).blobs, { recursive: true }).length : 0;
  const before = files();
  const commands: [Actor, CommandInput][] = [
    [system, { ...start, number: 9 } as CommandInput],
    [agent, { ...propose(), number: 9 } as CommandInput],
  ];
  for (const [who, cmd] of commands) {
    assert.equal(((await h(who, cmd)) as DomainError).code, "task_not_found");
  }
  assert.equal(files(), before);
});

const blobCount = () =>
  existsSync(paths(home).blobs) ? readdirSync(paths(home).blobs, { recursive: true }).length : 0;

test("aprobar una versión de plan obsoleta: stale_plan_version, sin eventos ni blobs", async () => {
  const h = await inReview();
  const [events, blobs0] = [store.currentVersion("task:1"), blobCount()];
  const r = await h(human, { type: "approvePlan", number: 1, planVersion: 0 });
  assert.equal((r as DomainError).code, "stale_plan_version");
  const r2 = await h(human, {
    type: "requestPlanChanges",
    number: 1,
    planVersion: 0,
    category: "scope",
    text: "motivo que no debe guardarse",
  });
  assert.equal((r2 as DomainError).code, "stale_plan_version");
  assert.equal(store.currentVersion("task:1"), events);
  assert.equal(blobCount(), blobs0);
});

test("abrir una segunda sesión activa: session_already_active, sin eventos ni blobs", async () => {
  const h = handle();
  ok(await h(human, task));
  ok(await h(human, { type: "submit", number: 1 }));
  ok(await h(system, start));
  const [events, blobs0] = [store.currentVersion("task:1"), blobCount()];
  const second = {
    ...start,
    session: { ...start.session, sessionId: "ses_2", prompt: "otro prompt", policy: "otra" },
  } as CommandInput;
  const r = await h(system, second);
  assert.equal((r as DomainError).code, "session_already_active");
  assert.equal(store.currentVersion("task:1"), events);
  assert.equal(blobCount(), blobs0);
});
