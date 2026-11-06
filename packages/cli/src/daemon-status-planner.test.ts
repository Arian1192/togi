import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { runCli } from "./testing/run-cli.ts";

async function statusWith(plannerStatus?: Parameters<typeof startDaemon>[2]) {
  const root = mkdtempSync(join(tmpdir(), "togi-planner-status-"));
  const home = join(root, "home");
  const daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" }, plannerStatus);
  try {
    return await runCli(["daemon", "status", "--no-color"], home);
  } finally {
    await daemon.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test("daemon status dice que el planificador está activo", async () => {
  const r = await statusWith({ plannerStatus: { state: "active", reason: "agente real" } });
  assert.match(r.stdout, /pid \d+ · planificador activo · .+togi\.sock\n$/);
});

test("daemon status dice que está desactivado y por qué", async () => {
  const r = await statusWith({
    plannerStatus: { state: "disabled", reason: "TOGI_PLANNER=off en el entorno del daemon" },
  });
  assert.match(
    r.stdout,
    / · planificador desactivado \(TOGI_PLANNER=off en el entorno del daemon\) · /,
  );
});

test("daemon status dice que no está disponible en esta plataforma", async () => {
  const r = await statusWith({
    plannerStatus: { state: "unavailable", reason: "sin sandbox en la plataforma linux" },
  });
  assert.match(r.stdout, / · planificador no disponible \(sin sandbox en la plataforma linux\) · /);
});

test("sin planificador configurado, también lo dice", async () => {
  assert.match((await statusWith()).stdout, / · planificador desactivado \(/);
});
