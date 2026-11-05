import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startDaemon } from "../start.ts";
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
