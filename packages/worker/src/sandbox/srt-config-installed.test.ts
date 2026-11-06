import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { SandboxSpec } from "@togi/core";
import { SandboxSpecError, toSrtConfig } from "./srt-config.ts";

// La disposición de `togi install`: las versiones viven en ~/Library/Application Support/togi/releases,
// fuera de TOGI_HOME (~/.togi), porque toSrtConfig no admite runtimePaths dentro de TOGI_HOME.
const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-srt-installed-")));
const home = join(root, "home");
const togiHome = join(home, ".togi");
const release = join(home, "Library", "Application Support", "togi", "releases", "v1.0.0");
const worker = join(release, "packages", "worker");
const sdk = join(release, "node_modules", ".pnpm", "sdk@1", "node_modules", "@anthropic-ai", "sdk");
const native = join(
  release,
  "node_modules",
  ".pnpm",
  "sdk@1",
  "node_modules",
  "@anthropic-ai",
  "native",
);
const nodeDir = join(root, "node", "bin");
const repo = join(togiHome, "workspaces", "s1", "repo");
const scratch = join(togiHome, "workspaces", "s1", "scratch");
for (const d of [worker, sdk, native, nodeDir, repo, scratch]) mkdirSync(d, { recursive: true });

const spec = (): SandboxSpec => ({
  readPaths: [repo],
  writeDir: scratch,
  allowedDomains: ["api.example.com"],
  allowedEnv: ["PATH"],
  credentials: [],
  timeoutMs: 1000,
});

test("la ruta del trabajador instalado fuera de TOGI_HOME es aceptada por toSrtConfig", () => {
  const config = toSrtConfig(spec(), {
    home,
    togiHome,
    runtimePaths: [nodeDir, worker, sdk, native],
  });
  for (const p of [worker, sdk, native]) assert.ok(config.filesystem?.allowRead?.includes(p));
});

test("la misma instalación dentro de TOGI_HOME sí se rechaza", () => {
  const inside = join(togiHome, "releases", "v1.0.0", "packages", "worker");
  mkdirSync(inside, { recursive: true });
  assert.throws(
    () => toSrtConfig(spec(), { home, togiHome, runtimePaths: [nodeDir, inside] }),
    SandboxSpecError,
  );
});

test("limpieza", () => {
  rmSync(root, { recursive: true, force: true });
});
