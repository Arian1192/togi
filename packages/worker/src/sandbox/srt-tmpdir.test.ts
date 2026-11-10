import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RunReaper } from "./reap.ts";
import { type SrtManager, SrtSandbox, withTmpdir } from "./srt-sandbox.ts";

// srt fija TMPDIR con lo que diga CLAUDE_CODE_TMPDIR en el proceso que envuelve el comando. togi le
// da el directorio escribible de la ejecución, y solo mientras envuelve.

const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-tmpdir-")));
const togiHome = join(root, "togi");
const repo = join(togiHome, "workspaces", "s1", "repo");
const scratch = join(togiHome, "workspaces", "s1", "scratch");
mkdirSync(repo, { recursive: true });
mkdirSync(scratch, { recursive: true });

const noReaper = (): RunReaper => ({
  env: {},
  fd: "ignore",
  async begin() {},
  watch() {},
  async sweep() {},
});

test("al envolver el comando, CLAUDE_CODE_TMPDIR es el directorio escribible; después, el de antes", async () => {
  process.env.CLAUDE_CODE_TMPDIR = "/otro";
  let seen: string | undefined;
  const manager: SrtManager = {
    isSupportedPlatform: () => true,
    async initialize() {},
    async wrapWithSandboxArgv(command) {
      seen = process.env.CLAUDE_CODE_TMPDIR;
      return { argv: ["/bin/sh", "-c", command] };
    },
    async reset() {},
  };
  const sandbox = new SrtSandbox({
    togiHome,
    runtimePaths: [],
    home: join(root, "home"),
    manager,
    reaper: noReaper,
  });
  const spec = {
    readPaths: [repo],
    writeDir: scratch,
    allowedDomains: [],
    allowedEnv: ["PATH"],
    credentials: [],
    timeoutMs: 5000,
  };
  await sandbox.run(spec, ["/usr/bin/true"]);
  assert.equal(seen, scratch);
  assert.equal(process.env.CLAUDE_CODE_TMPDIR, "/otro");
});

test("si no había CLAUDE_CODE_TMPDIR, no queda puesto, tampoco si envolver falla", async () => {
  delete process.env.CLAUDE_CODE_TMPDIR;
  await assert.rejects(
    withTmpdir(scratch, async () => {
      throw new Error("falla");
    }),
  );
  assert.equal(process.env.CLAUDE_CODE_TMPDIR, undefined);
});
