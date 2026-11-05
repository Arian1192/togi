import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { runCli } from "./testing/run-cli.ts";

async function withDaemon(
  body: (home: string, d: Awaited<ReturnType<typeof startDaemon>>) => Promise<void>,
) {
  const root = mkdtempSync(join(tmpdir(), "togi-verify-traj-"));
  const home = join(root, "home");
  const daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
  try {
    for (let i = 0; i < 3; i++) await daemon.agentEvents.append("ses_a", 1, "message", { i });
    await body(home, daemon);
  } finally {
    await daemon.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test("una trayectoria íntegra sale con 0", () =>
  withDaemon(async (home) => {
    const r = await runCli(["admin", "verify-log", "--no-color"], home);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Log íntegro/);
  }));

test("una trayectoria rota sale con 1 y nombra la sesión y el evento", () =>
  withDaemon(async (home, d) => {
    d.db.exec("DROP TRIGGER agent_events_no_update");
    d.db.prepare("UPDATE agent_events SET payload = '{}' WHERE seq = 2").run();
    const r = await runCli(["admin", "verify-log", "--no-color"], home);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /evento #2 de la trayectoria de la sesión ses_a/);
    const json = await runCli(["admin", "verify-log", "--json"], home);
    assert.deepEqual(JSON.parse(json.stdout), { ok: false, brokenAt: 2, session: "ses_a" });
  }));
