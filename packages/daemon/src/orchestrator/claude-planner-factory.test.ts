import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { claudeAgentSdkDeclaration } from "../../../worker/src/adapters/claude-agent-sdk/declaration.ts";
import { startDaemon } from "../start.ts";
import { claudePlanner } from "./claude-planner-factory.ts";

const WORKER = join(import.meta.dirname, "..", "..", "..", "worker");
const env = (extra: Record<string, string> = {}) => ({ TOGI_KEYCHAIN: "file", ...extra });

async function start(extra: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "togi-factory-"));
  const log: string[] = [];
  const planner = claudePlanner({
    workerPackageDir: WORKER,
    declaration: claudeAgentSdkDeclaration,
    log: (line) => log.push(line),
  });
  try {
    const daemon = await startDaemon(join(root, "home"), env(extra), { planner });
    await daemon.close();
    return { log };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("al arrancar registra el tope de coste por defecto", async () => {
  const { log } = await start({});
  assert.deepEqual(log, ["planificador: tope de coste por sesión 1 USD (por defecto)"]);
});

test("al arrancar registra el tope configurado", async () => {
  const { log } = await start({ TOGI_MAX_SESSION_COST_USD: "2.5" });
  assert.deepEqual(log, [
    "planificador: tope de coste por sesión 2.5 USD (TOGI_MAX_SESSION_COST_USD)",
  ]);
});

test("un tope inválido hace fallar el arranque con un error claro, sin registrar nada", async () => {
  for (const bad of ["0", "-3", "mucho", "500"]) {
    const log: string[] = [];
    const root = mkdtempSync(join(tmpdir(), "togi-factory-"));
    const planner = claudePlanner({
      workerPackageDir: WORKER,
      declaration: claudeAgentSdkDeclaration,
      log: (line) => log.push(line),
    });
    await assert.rejects(
      startDaemon(join(root, "home"), env({ TOGI_MAX_SESSION_COST_USD: bad }), { planner }),
      /TOGI_MAX_SESSION_COST_USD=.* no es válido/,
      bad,
    );
    assert.deepEqual(log, []);
    rmSync(root, { recursive: true, force: true });
  }
});
