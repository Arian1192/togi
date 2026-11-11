import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SandboxRuntimeConfigSchema } from "@anthropic-ai/sandbox-runtime";
import { type SandboxSpec, ToWorker } from "@togi/core";
import { pnpmLockDir, SandboxSpecError, toSrtConfig } from "./srt-config.ts";

// El árbol escribible del clon de la tarea y el bloqueo de pnpm de la instalación (ADR-011 §2-§4).

const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-srt-tree-")));
const home = join(root, "home");
const togiHome = join(home, ".togi");
const wsp = join(togiHome, "workspaces", "wsp_1");
const tree = join(wsp, "tree");
const gitDir = join(wsp, "git");
const scratch = join(togiHome, "workspaces", "wsp_1.install");
for (const d of [tree, gitDir, scratch, join(wsp, "scratch")]) mkdirSync(d, { recursive: true });
const ctx = { home, togiHome, runtimePaths: [], tmpDirs: [], uid: 501 };

const base = (over: Partial<SandboxSpec> = {}): SandboxSpec => ({
  readPaths: [tree],
  writeDir: scratch,
  allowedDomains: ["registry.npmjs.org"],
  allowedEnv: ["PATH"],
  credentials: [],
  timeoutMs: 1000,
  ...over,
});
const refuses = (spec: SandboxSpec, re: RegExp) =>
  assert.throws(
    () => toSrtConfig(spec, ctx),
    (e) => e instanceof SandboxSpecError && re.test(e.message),
  );

test("sin los campos nuevos, la configuración no cambia", () => {
  const c = toSrtConfig(base(), ctx);
  assert.deepEqual(c.filesystem.allowWrite, [scratch]);
  assert.deepEqual(c.filesystem.allowRead, [tree, scratch]);
});

test("workTree se puede escribir y leer, además de writeDir", () => {
  const c = toSrtConfig(base({ readPaths: [], workTree: tree }), ctx);
  assert.deepEqual(c.filesystem.allowWrite, [scratch, tree]);
  assert.deepEqual(c.filesystem.allowRead, [scratch, tree]);
  assert.ok(!c.filesystem.allowRead?.includes(gitDir));
  assert.ok(!c.filesystem.allowRead?.includes(wsp));
  SandboxRuntimeConfigSchema.parse(c);
});

test("workTree solo bajo workspaces/, sin solaparse con writeDir ni readPaths", () => {
  for (const p of [togiHome, join(togiHome, "workspaces"), home, join(root, "fuera")]) {
    mkdirSync(p, { recursive: true });
    refuses(base({ readPaths: [], workTree: p }), /workTree/);
  }
  refuses(base({ readPaths: [], workTree: wsp, writeDir: join(wsp, "scratch") }), /workTree/);
  refuses(base({ readPaths: [], workTree: tree, writeDir: tree }), /workTree/);
  refuses(base({ readPaths: [wsp], workTree: tree }), /workTree/);
});

test("pnpmLocks deja escribir solo el bloqueo de pnpm del usuario, nada más de /tmp", () => {
  const lock = "/private/tmp/pnpm-store-operation-locks-501";
  assert.equal(pnpmLockDir(501), lock);
  const c = toSrtConfig(base({ readPaths: [], workTree: tree, pnpmLocks: true }), ctx);
  assert.deepEqual(c.filesystem.allowWrite, [scratch, tree, lock]);
  assert.ok(c.filesystem.allowRead?.includes(lock));
  assert.ok(c.filesystem.denyRead.includes("/private/tmp"));
  assert.ok(!c.filesystem.allowWrite.includes("/private/tmp"));
  SandboxRuntimeConfigSchema.parse(c);
});

test("pnpmLocks no admite credenciales: es la instalación, sin agente", () => {
  refuses(
    base({
      pnpmLocks: true,
      allowedDomains: ["api.example.com"],
      credentials: [{ name: "K", injectDomains: ["api.example.com"] }],
    }),
    /pnpmLocks/,
  );
});

test("el protocolo admite workTree y pnpmLocks, y nada más nuevo", () => {
  const order = {
    type: "session",
    sessionId: "ins_1",
    spec: { ...base(), workTree: tree, pnpmLocks: true },
    workspacesRoot: join(togiHome, "workspaces"),
    runtimePaths: [],
    argv: ["pnpm", "install"],
    credential: null,
  };
  assert.ok(ToWorker.safeParse(order).success);
  const extra = { ...order, spec: { ...order.spec, lockDir: "/tmp/x" } };
  assert.equal(ToWorker.safeParse(extra).success, false);
  const wrong = { ...order, spec: { ...order.spec, pnpmLocks: "sí" } };
  assert.equal(ToWorker.safeParse(wrong).success, false);
});
