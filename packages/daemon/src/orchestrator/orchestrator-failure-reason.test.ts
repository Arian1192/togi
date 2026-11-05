import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { Actor } from "@togi/core";
import type Database from "better-sqlite3";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { type CreateTaskInput, createHandler } from "../commands/handle-command.ts";
import { paths } from "../config/app.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { FakePlanner } from "../testing/fake-planner.ts";
import { createOrchestrator } from "./orchestrator.ts";
import type { Planner, PlanOutcome } from "./planner.ts";

let home: string;
let db: Database.Database;
let store: SqliteEventStore;
let handle: ReturnType<typeof createHandler>;
const human: Actor = { kind: "human", userId: "usr_1" };
const system: Actor = { kind: "system", component: "adapter:planner" };
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
const usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, durationMs: 0 };

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-orq-reason-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  store = new SqliteEventStore(db);
  const keys = new DataKeyring(
    db,
    await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } })),
  );
  handle = createHandler({ db, store, blobs: new FileBlobStore(p.blobs, keys) });
  db.prepare("INSERT INTO repos (repo, path, added_at) VALUES ('r', '/clon/r', 'now')").run();
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

/** Un planificador falso cuyo resultado fija el test. */
const planner = (plan: Planner["plan"]): Planner => ({
  identity: new FakePlanner().identity,
  plan,
});
/** Resultado y motivo de cada session.ended del log (la proyección llega en otro PR). */
const reasons = () =>
  (
    db.prepare("SELECT payload FROM events WHERE type = 'session.ended' ORDER BY seq").all() as {
      payload: string;
    }[]
  ).map((r) => {
    const p = JSON.parse(r.payload);
    return { outcome: p.outcome, reason: p.failureReason };
  });
/** El motivo que quedó en el evento del log, no solo en la proyección. */
const loggedReasons = () =>
  (
    db.prepare("SELECT payload FROM events WHERE type = 'session.ended' ORDER BY seq").all() as {
      payload: string;
    }[]
  ).map((r) => JSON.parse(r.payload).failureReason);

async function submitAndPlan(p?: Planner) {
  const orq = createOrchestrator({ db, store, handle, planner: p });
  orq.start();
  const made = await handle(human, task);
  assert.ok("number" in made);
  await handle(human, { type: "submit", number: made.number });
  await orq.idle();
  await orq.close();
}

test("un repo sin registrar queda en el evento como repo_not_registered", async () => {
  db.prepare("DELETE FROM repos").run();
  await submitAndPlan(new FakePlanner());
  assert.deepEqual(reasons(), [{ outcome: "failed", reason: "repo_not_registered" }]);
  assert.deepEqual(loggedReasons(), ["repo_not_registered"]);
});

test("un planificador que devuelve ok:false sin código deja planner_failed", async () => {
  await submitAndPlan(new FakePlanner(() => true));
  assert.deepEqual(reasons(), [{ outcome: "failed", reason: "planner_failed" }]);
});

test("un planificador que devuelve su propio código lo deja en el evento", async () => {
  await submitAndPlan(
    planner(
      async (): Promise<PlanOutcome> => ({
        ok: false,
        reason: "texto libre solo para el log",
        code: "timeout",
        usage,
      }),
    ),
  );
  assert.deepEqual(reasons(), [{ outcome: "failed", reason: "timeout" }]);
  assert.ok(!loggedReasons().join().includes("texto libre"));
});

test("un código que no está en FAILURE_REASONS queda como planner_failed y no se guarda", async () => {
  await submitAndPlan(
    planner(
      async (): Promise<PlanOutcome> => ({
        ok: false,
        reason: "fallo",
        code: "inventado_por_el_planificador" as never, // un adaptador que se salta el tipo
        usage,
      }),
    ),
  );
  assert.deepEqual(reasons(), [{ outcome: "failed", reason: "planner_failed" }]);
  assert.deepEqual(loggedReasons(), ["planner_failed"]);
  const stored = JSON.stringify(db.prepare("SELECT payload FROM events").all());
  assert.ok(!stored.includes("inventado"));
});

test("un planificador que lanza deja planner_error", async () => {
  await submitAndPlan(
    planner(async () => {
      throw new Error("/Users/ana/secreto");
    }),
  );
  assert.deepEqual(reasons(), [{ outcome: "failed", reason: "planner_error" }]);
  assert.ok(!loggedReasons().join().includes("secreto"));
});

test("un plan que el flujo rechaza deja invalid_plan", async () => {
  await submitAndPlan(
    planner(
      async (): Promise<PlanOutcome> => ({
        ok: true,
        usage,
        plan: {
          files: [{ path: "../fuera", change: "modify" }],
          newTests: [],
          approach: "x",
          estimatedLines: { production: 1, tests: 1 },
          baseSha: "abc",
        },
      }),
    ),
  );
  assert.deepEqual(reasons(), [{ outcome: "failed", reason: "invalid_plan" }]);
});

test("al arrancar, la sesión que quedó abierta se cierra como daemon_restarted", async () => {
  const made = await handle(human, task);
  assert.ok("number" in made);
  await handle(human, { type: "submit", number: made.number });
  await handle(system, {
    type: "startSession",
    number: made.number,
    session: {
      sessionId: "ses_viejo",
      role: "planner",
      cycle: null,
      runtime: { id: "fake", version: "1" },
      model: "fake",
      specialist: { id: "fake-planner", version: 1, hash: "sha256:x" },
      workspaceId: null,
      prompt: "p",
      policy: "p",
    },
  });
  await createOrchestrator({ db, store, handle }).recover();
  assert.deepEqual(reasons(), [{ outcome: "failed", reason: "daemon_restarted" }]);
});

test("una sesión completada no lleva motivo", async () => {
  await submitAndPlan(new FakePlanner());
  assert.deepEqual(reasons(), [{ outcome: "completed", reason: null }]);
  assert.deepEqual(loggedReasons(), [null]);
});
