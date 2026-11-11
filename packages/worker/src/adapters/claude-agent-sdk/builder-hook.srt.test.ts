import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { SrtSandbox } from "../../sandbox/srt-sandbox.ts";
import type { BuilderRun } from "./builder-run.ts";

// Con el srt real: la política del builder y su raíz funcionan dentro del sandbox, sobre el árbol
// del clon, y el módulo carga viendo solo Node y el paquete del trabajador (sin core ni el SDK).
// Que el SDK real respete el hook lo cubre la prueba de ataque del paso 6 (ADR-011 §9).

const skip = process.platform === "darwin" ? undefined : "srt solo funciona en macOS (Seatbelt)";
const WORKER = realpathSync(join(import.meta.dirname, "..", "..", ".."));
const NODE = dirname(realpathSync(process.execPath));
const STAND_IN = join(import.meta.dirname, "testing", "builder-stand-in.ts");

test("dentro de srt, el hook del builder deja el fichero del plan y deniega el resto", {
  skip,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-builder-srt-")));
  const home = join(root, "home");
  const togiHome = join(home, ".togi");
  const tree = join(togiHome, "workspaces", "wsp_1", "tree");
  const scratch = join(togiHome, "workspaces", "wsp_1", "builder");
  for (const d of [join(tree, "src"), scratch]) mkdirSync(d, { recursive: true });
  writeFileSync(join(tree, "package.json"), "{}\n");
  writeFileSync(join(tree, "src", "a.test.ts"), "original\n");
  const run: BuilderRun = {
    prompt: "p",
    cwd: tree,
    model: "m",
    effort: "medium",
    maxTurns: 5,
    maxBudgetUsd: 1,
    policy: {
      checks: { typecheck: "pnpm typecheck", lint: null, test: "pnpm test" },
      planFiles: ["src/a.ts"],
      existingTests: ["src/a.test.ts"],
      protectedPaths: ["package.json"],
    },
  };
  const write = (file: string, tool_name = "Write") => ({
    tool_name,
    tool_input: { file_path: join(tree, file), content: "nuevo\n" },
  });
  const bash = (command: string) => ({ tool_name: "Bash", tool_input: { command } });
  const calls: object[] = [write("src/a.ts"), write("package.json")];
  calls.push(write("src/a.test.ts", "Edit"), bash("curl https://example.com"));
  calls.push(bash("pnpm test; rm -rf ."));
  const sandbox = new SrtSandbox({ togiHome, home, runtimePaths: [NODE, WORKER] });
  try {
    const result = await sandbox.run(
      {
        readPaths: [],
        writeDir: scratch,
        workTree: tree,
        allowedDomains: [],
        allowedEnv: ["PATH"],
        credentials: [],
        timeoutMs: 20_000,
      },
      [process.execPath, STAND_IN],
      JSON.stringify({ run, calls }),
    );
    assert.equal(result.exitCode, 0, result.stderr);
    const lines = result.stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.deepEqual(lines[0], { cwd: tree });
    assert.deepEqual(lines[1], { sdk: false, core: false });
    const decisions = lines.filter((l) => "tool" in l).map((l) => l.denied);
    assert.deepEqual(decisions, [false, true, true, true, true]);
    assert.equal(lines.filter((l) => l.line === "denied").length, 4);
    assert.equal(lines.at(-1)?.line, "usage");
    assert.equal(readFileSync(join(tree, "src", "a.ts"), "utf8"), "nuevo\n");
    assert.equal(readFileSync(join(tree, "package.json"), "utf8"), "{}\n");
    assert.equal(readFileSync(join(tree, "src", "a.test.ts"), "utf8"), "original\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
