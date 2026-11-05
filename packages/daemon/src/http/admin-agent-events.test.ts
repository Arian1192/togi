import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startDaemon } from "../start.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { socketClient } from "../testing/socket-client.ts";

async function withDaemon(
  body: (
    d: Awaited<ReturnType<typeof startDaemon>>,
    call: ReturnType<typeof socketClient>,
  ) => Promise<void>,
) {
  const root = mkdtempSync(join(tmpdir(), "togi-adm-traj-"));
  const home = join(root, "home");
  const daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
  try {
    await body(daemon, socketClient(home));
  } finally {
    await daemon.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test("verify-log da ok con la trayectoria íntegra", () =>
  withDaemon(async (d, call) => {
    for (let i = 0; i < 3; i++) await d.agentEvents.append("ses_a", 1, "message", { i });
    const res = await call("POST", "/v1/admin/verify-log");
    assert.deepEqual([res.status, res.json], [200, { ok: true }]);
  }));

test("verify-log recorre también las cadenas de sesión y nombra la sesión rota", () =>
  withDaemon(async (d, call) => {
    for (let i = 0; i < 3; i++) await d.agentEvents.append("ses_a", 1, "message", { i });
    d.db.exec("DROP TRIGGER agent_events_no_update");
    d.db.prepare("UPDATE agent_events SET payload = '{}' WHERE seq = 3").run();
    const res = await call("POST", "/v1/admin/verify-log");
    assert.deepEqual([res.status, res.json], [200, { ok: false, brokenAt: 3, session: "ses_a" }]);
  }));

const endedWith = (d: Awaited<ReturnType<typeof startDaemon>>, n: number) =>
  new SqliteEventStore(d.db).append("task:1", 0, [
    {
      type: "session.ended",
      schemaVersion: 1,
      actor: { kind: "system", component: "adapter:test" },
      at: "2026-11-05T10:00:00.000Z",
      payload: {
        sessionId: "ses_a",
        outcome: "completed",
        usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, durationMs: 0 },
        trajectoryEvents: n,
      },
    },
  ]);

test("verify-log detecta un final truncado y una sesión borrada entera", () =>
  withDaemon(async (d, call) => {
    for (let i = 0; i < 3; i++) await d.agentEvents.append("ses_a", 1, "message", { i });
    await endedWith(d, 3);
    assert.deepEqual((await call("POST", "/v1/admin/verify-log")).json, { ok: true });
    d.db.exec("DROP TRIGGER agent_events_no_delete");
    d.db.prepare("DELETE FROM agent_events WHERE seq = 3").run();
    assert.deepEqual((await call("POST", "/v1/admin/verify-log")).json, {
      ok: false,
      brokenAt: 3,
      session: "ses_a",
    });
    d.db.prepare("DELETE FROM agent_events").run();
    assert.deepEqual((await call("POST", "/v1/admin/verify-log")).json, {
      ok: false,
      brokenAt: 1,
      session: "ses_a",
    });
  }));
