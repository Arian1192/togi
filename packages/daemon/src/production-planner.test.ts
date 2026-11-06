import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { productionPlanner } from "./production-planner.ts";
import { startDaemon } from "./start.ts";

test("en macOS el daemon real usa el planificador real", () => {
  const { source, status } = productionPlanner("darwin");
  assert.equal(typeof source, "function");
  assert.equal(status.state, "active");
});

test("en cualquier otra plataforma no hay planificador y el estado es unavailable", () => {
  for (const platform of ["linux", "win32", "freebsd"] as const) {
    const { source, status } = productionPlanner(platform);
    assert.equal(source, undefined, platform);
    assert.deepEqual(status, {
      state: "unavailable",
      reason: `sin sandbox en la plataforma ${platform}`,
    });
  }
});

test("TOGI_PLANNER=off lo desactiva también en macOS y dice por qué", () => {
  const { source, status } = productionPlanner("darwin", { TOGI_PLANNER: "off" });
  assert.equal(source, undefined);
  assert.equal(status.state, "disabled");
  assert.match(status.reason, /TOGI_PLANNER=off/);
});

test("sin planificador el daemon arranca y se cierra", async () => {
  const root = mkdtempSync(join(tmpdir(), "togi-no-planner-"));
  try {
    const daemon = await startDaemon(join(root, "home"), { TOGI_KEYCHAIN: "file" });
    await daemon.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
