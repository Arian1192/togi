import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { claudeAgentSdkDeclaration } from "../../../worker/src/adapters/claude-agent-sdk/declaration.ts";
import { SrtSandbox } from "../../../worker/src/sandbox/srt-sandbox.ts";
import { claudeRuntime } from "./runtime-paths.ts";

const WORKER = join(import.meta.dirname, "..", "..", "..", "worker");
const ENTRY = join(WORKER, "src", "adapters", "claude-agent-sdk", "main.ts");
const skip = process.platform === "darwin" ? undefined : "SrtSandbox solo funciona en macOS";

/** El adaptador real con el SDK real dentro de srt, sin ninguna credencial. */
async function runAdapter(withExecutable: boolean) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-binary-")));
  try {
    const home = join(root, "togi");
    const copy = join(home, "workspaces", "s1");
    const scratch = join(home, "workspaces", "s1.scratch");
    mkdirSync(copy, { recursive: true });
    mkdirSync(scratch, { recursive: true });
    const runtime = claudeRuntime(WORKER);
    const declaration = claudeAgentSdkDeclaration("subscription");
    const input = {
      prompt: "hola",
      cwd: copy,
      model: "claude-sonnet-5-5",
      maxBudgetUsd: 0.05,
      ...(withExecutable ? { executable: runtime.executable } : {}),
    };
    const result = await new SrtSandbox({ togiHome: home, runtimePaths: runtime.paths }).run(
      {
        readPaths: [copy],
        writeDir: scratch,
        allowedDomains: [...declaration.domains],
        allowedEnv: ["PATH", ...declaration.clearEnv],
        credentials: [],
        timeoutMs: 60_000,
      },
      [process.execPath, ENTRY],
      JSON.stringify(input),
    );
    return { ...result, scratchEntries: readdirSync(scratch) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("con el ejecutable que resuelve el daemon, el SDK pasa del binario y falla al autenticarse", {
  skip,
}, async () => {
  const r = await runAdapter(true);
  const seen = `salida ${r.exitCode}; stdout=[${r.stdout}]; stderr=[${r.stderr.slice(-600)}]; scratch=${r.scratchEntries.join(",")}`;
  assert.equal(r.timedOut, false, seen);
  // Un fallo, no un éxito ni un cuelgue.
  assert.equal(r.exitCode, 1, seen);
  // 1. El binario se encontró: el SDK no lo buscó y no lo echó en falta.
  assert.ok(
    !/Native CLI binary|executable_not_found|not found at the configured/.test(r.stderr),
    seen,
  );
  // 2. Se ejecutó: el SDK habla de lo que hizo el proceso, no de que no pudiera lanzarlo.
  assert.match(
    r.stderr,
    /error del SDK: Claude Code (returned an error result|process exited)/,
    seen,
  );
  assert.ok(!/failed to launch|ENOENT|EACCES/.test(r.stderr), seen);
  // 3. Usó el directorio desechable de la sesión para lo que escribe, no /tmp (que srt deniega: en
  //    el runner de la CI, `mkdir /tmp/claude-<uid>` daba EPERM porque esa carpeta no existía).
  assert.ok(
    r.scratchEntries.some((e) => e.startsWith("claude-")),
    seen,
  );
  assert.ok(!r.stderr.includes("EPERM"), seen);
});

test("control: sin ese ejecutable, la búsqueda del SDK dentro del sandbox no encuentra el binario", {
  skip,
}, async () => {
  const r = await runAdapter(false);
  assert.equal(r.exitCode, 1);
  assert.ok(r.stderr.includes("Native CLI binary for"), r.stderr.slice(-400));
});
