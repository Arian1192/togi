import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startDaemon } from "./start.ts";
import { FakePlanner } from "./testing/fake-planner.ts";

const env = { TOGI_KEYCHAIN: "file", TOGI_PLANNER: "fake" };

test("sin planner explícito, el daemon no planifica aunque el entorno lo pida", async () => {
  const root = mkdtempSync(join(tmpdir(), "togi-start-"));
  const daemon = await startDaemon(join(root, "home"), env);
  const row = daemon.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number };
  assert.equal(row.n, 0);
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

test("con un planner pasado desde el código, el arranque lo acepta", async () => {
  const root = mkdtempSync(join(tmpdir(), "togi-start-"));
  const daemon = await startDaemon(join(root, "home"), env, { planner: new FakePlanner() });
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});
