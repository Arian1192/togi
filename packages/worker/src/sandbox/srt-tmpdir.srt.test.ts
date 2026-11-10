import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SrtSandbox } from "./srt-sandbox.ts";

// Con el srt real: dentro del sandbox, TMPDIR es el directorio escribible de la ejecución y se puede
// escribir en él. Antes, srt lo cambiaba por /tmp/claude, denegado, y herramientas como pnpm caían a
// /tmp (lo vio la prueba de promos del ADR-011).

const skip = process.platform === "darwin" ? undefined : "srt solo funciona en macOS (Seatbelt)";

test("dentro de srt, TMPDIR es el directorio escribible y se puede escribir en él", {
  skip,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-tmpdir-srt-")));
  const home = join(root, "home");
  const togiHome = join(home, ".togi");
  const repo = join(togiHome, "workspaces", "s1", "repo");
  const scratch = join(togiHome, "workspaces", "s1", "scratch");
  mkdirSync(repo, { recursive: true });
  mkdirSync(scratch, { recursive: true });
  const sandbox = new SrtSandbox({ togiHome, home, runtimePaths: [] });
  const spec = {
    readPaths: [repo],
    writeDir: scratch,
    allowedDomains: [],
    allowedEnv: ["PATH"],
    credentials: [],
    timeoutMs: 20_000,
  };
  const printed = await sandbox.run(spec, ["/usr/bin/printenv", "TMPDIR"]);
  assert.equal(printed.exitCode, 0, printed.stderr);
  assert.equal(printed.stdout.trim(), scratch);
  const wrote = await sandbox.run(spec, ["/bin/sh", "-c", 'echo hola > "$TMPDIR/escrito"']);
  assert.equal(wrote.exitCode, 0, wrote.stderr);
  assert.ok(existsSync(join(scratch, "escrito")));
});
