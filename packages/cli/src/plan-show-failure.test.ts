import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Actor, FailureReason } from "@togi/core";
import { paths } from "@togi/daemon/config";
import { FileBlobStore } from "../../daemon/src/blobs/file-blob-store.ts";
import { createHandler } from "../../daemon/src/commands/handle-command.ts";
import { DataKeyring } from "../../daemon/src/keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../../daemon/src/keys/master-key.ts";
import { selectKeychain } from "../../daemon/src/keys/select-keychain.ts";
import { rebuildProjections } from "../../daemon/src/projections/index.ts";
import type { startDaemon } from "../../daemon/src/start.ts";
import { SqliteEventStore } from "../../daemon/src/store/event-store.ts";
import { runCli } from "./testing/run-cli.ts";
import { seedPlans } from "./testing/seed-plan.ts";

const system: Actor = { kind: "system", component: "adapter:planner" };
const usage = { inputTokens: 1, outputTokens: 2, estimatedCostUsd: 0.1, durationMs: 5 };

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
let handle: ReturnType<typeof createHandler>;
let store: SqliteEventStore;
let seed: Awaited<ReturnType<typeof seedPlans>>["plan"];
let requestChanges: Awaited<ReturnType<typeof seedPlans>>["requestChanges"];
let sessions = 0;
before(async () => {
  const { startDaemon } = await import("../../daemon/src/start.ts");
  root = mkdtempSync(join(tmpdir(), "togi-plan-failure-"));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
  const keys = new DataKeyring(
    daemon.db,
    await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } })),
  );
  store = new SqliteEventStore(daemon.db);
  handle = createHandler({
    db: daemon.db,
    store,
    blobs: new FileBlobStore(paths(home).blobs, keys),
  });
  ({ plan: seed, requestChanges } = await seedPlans(home, daemon));
});
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

async function submitted(): Promise<number> {
  const made = await runCli(
    ["task", "new", "Exportar", "--risk", "low", "--repo", "o/r", "--criteria", "c", "--json"],
    home,
  );
  const n = JSON.parse(made.stdout).number as number;
  assert.equal((await runCli(["task", "submit", String(n)], home)).code, 0);
  return n;
}
const start = async (number: number) => {
  const sessionId = `ses_f${++sessions}` as const;
  const started = await handle(system, {
    type: "startSession",
    number,
    session: {
      sessionId,
      role: "planner",
      cycle: null,
      runtime: { id: "fake", version: "1" },
      model: "m",
      specialist: { id: "generic-planner", version: 1, hash: "sha256:abc" },
      workspaceId: null,
      prompt: "p",
      policy: "q",
    },
  });
  assert.ok("events" in started, JSON.stringify(started));
  return sessionId;
};
/** Una sesión que termina con el resultado y el motivo dados, por el camino normal. */
async function ended(number: number, outcome: "failed" | "timeout", failureReason: FailureReason) {
  const sessionId = await start(number);
  const end = { sessionId, outcome, usage, trajectoryEvents: 0, failureReason };
  const result = await handle(system, { type: "endSession", number, session: end });
  assert.ok("events" in result, JSON.stringify(result));
}
const show = (n: number, ...flags: string[]) =>
  runCli(["plan", "show", String(n), "--no-color", ...flags], home);

test("sin plan, el error explica por qué terminó mal la última sesión", async () => {
  const n = await submitted();
  await ended(n, "timeout", "timeout");
  const r = await show(n);
  assert.equal(r.code, 7);
  assert.match(r.stderr, /no tiene plan\./);
  assert.match(r.stderr, /Última sesión: se agotó el tiempo de la sesión\./);
});

test("con plan, y la última sesión fallida, lo muestra tras el plan y en --json", async () => {
  const n = await submitted();
  await seed(n);
  await requestChanges(n, 1); // vuelve a planning; la sesión nueva falla y el plan v1 sigue vigente
  await ended(n, "timeout", "worker_died");
  const r = await show(n);
  assert.equal(r.code, 0, r.stderr);
  assert.match(
    r.stdout,
    /Enfoque\n {2}el enfoque\n\n.*Última sesión: el trabajador murió antes de terminar\./,
  );
  const body = JSON.parse((await show(n, "--json")).stdout);
  assert.equal(body.lastSession.failureReason, "worker_died");
  assert.equal(body.planVersion, 1);
});

test("con la última sesión completada no añade nada, y --json trae lastSession null", async () => {
  const n = await submitted();
  await seed(n);
  assert.doesNotMatch((await show(n)).stdout, /Última sesión/);
  assert.equal(JSON.parse((await show(n, "--json")).stdout).lastSession, null);
});

test("una sesión fallida anterior al motivo (v1) no añade nada", async () => {
  const n = await submitted();
  const sessionId = await start(n);
  const version = (
    daemon.db.prepare("SELECT stream_version AS v FROM tasks WHERE number = ?").get(n) as {
      v: number;
    }
  ).v;
  await store.append(`task:${n}`, version, [
    {
      type: "session.ended",
      schemaVersion: 1,
      actor: system,
      at: new Date().toISOString(),
      payload: { sessionId, outcome: "failed", usage, trajectoryEvents: 0 },
    },
  ]);
  rebuildProjections(daemon.db, store);
  const r = await show(n);
  assert.equal(r.code, 7);
  assert.match(r.stderr, /no tiene plan\./);
  assert.doesNotMatch(r.stderr, /Última sesión/);
});

test("un código que esta CLI no conoce se muestra tal cual, sin romper", async () => {
  const n = await submitted();
  const sessionId = await start(n);
  daemon.db
    .prepare(
      "UPDATE sessions SET state = 'ended', outcome = 'failed', failure_reason = ? WHERE session_id = ?",
    )
    .run("motivo_nuevo", sessionId);
  const r = await show(n);
  assert.match(r.stderr, /Última sesión: motivo_nuevo\./);
});
