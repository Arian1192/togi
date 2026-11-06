import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { runCli } from "./testing/run-cli.ts";

async function statusWith(options?: Parameters<typeof startDaemon>[2]) {
  const root = mkdtempSync(join(tmpdir(), "togi-notify-status-"));
  const home = join(root, "home");
  const daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" }, options);
  try {
    return await runCli(["daemon", "status", "--no-color"], home);
  } finally {
    await daemon.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test("daemon status dice que las notificaciones están activas", async () => {
  const r = await statusWith({ notifyStatus: { state: "active", reason: "avisos de macOS" } });
  assert.match(r.stdout, / · planificador .+ · notificaciones activas · .+togi\.sock\n$/);
});

test("daemon status dice que están desactivadas y por qué", async () => {
  const r = await statusWith({
    notifyStatus: { state: "disabled", reason: "TOGI_NOTIFY=off en el entorno del daemon" },
  });
  assert.match(
    r.stdout,
    / · notificaciones desactivadas \(TOGI_NOTIFY=off en el entorno del daemon\) · /,
  );
});

test("daemon status dice que no están disponibles en esta plataforma", async () => {
  const r = await statusWith({
    notifyStatus: { state: "unavailable", reason: "sin notificaciones en la plataforma linux" },
  });
  assert.match(
    r.stdout,
    / · notificaciones no disponibles \(sin notificaciones en la plataforma linux\) · /,
  );
});

test("sin notificador configurado, también lo dice", async () => {
  assert.match((await statusWith()).stdout, / · notificaciones desactivadas \(/);
});
