import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { SandboxRuntimeConfigSchema } from "@anthropic-ai/sandbox-runtime";
import type { SandboxSpec } from "@togi/core";
import { SandboxSpecError, toSrtConfig, userTmpDirs } from "./srt-config.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-srt-")));
const home = join(root, "home");
const togiHome = join(home, ".togi");
const repo = join(togiHome, "workspaces", "s1", "repo");
const scratch = join(togiHome, "workspaces", "s1", "scratch");
const agent = join(root, "agent");
for (const d of [repo, scratch, agent, join(togiHome, "run"), join(home, ".ssh")]) {
  mkdirSync(d, { recursive: true });
}
const nodeDir = join(home, ".nvm", "versions", "node", "v22", "bin");
mkdirSync(nodeDir, { recursive: true });
const ctx = { home, togiHome, runtimePaths: [agent, nodeDir] };

const base = (over: Partial<SandboxSpec> = {}): SandboxSpec => ({
  readPaths: [repo],
  writeDir: scratch,
  allowedDomains: ["api.example.com"],
  allowedEnv: ["PATH", "LANG"],
  credentials: [{ name: "API_KEY", injectDomains: ["api.example.com"] }],
  timeoutMs: 1000,
  ...over,
});
const refuses = (spec: SandboxSpec, re: RegExp, c = ctx) =>
  assert.throws(
    () => toSrtConfig(spec, c),
    (e) => e instanceof SandboxSpecError && re.test(e.message),
  );

test("traduce la especificación a la configuración obligatoria del ADR-008", () => {
  const c = toSrtConfig(base(), ctx);
  assert.deepEqual(c.filesystem, {
    denyRead: [home, "/Users", "/Volumes", "/private/tmp", ...userTmpDirs()],
    allowRead: [agent, nodeDir, repo, scratch],
    allowWrite: [scratch],
    denyWrite: [],
  });
  assert.deepEqual(c.network.allowedDomains, ["api.example.com"]);
  assert.equal(c.network.strictAllowlist, true);
  assert.equal(c.network.allowLocalBinding, false);
  assert.equal(c.network.allowAllUnixSockets, false);
  assert.deepEqual(c.network.allowUnixSockets, []);
  assert.deepEqual(c.network.tlsTerminate, {});
  assert.deepEqual(c.credentials?.envVars, [
    { name: "API_KEY", mode: "mask", injectHosts: ["api.example.com"] },
  ]);
});

test("la configuración generada es válida para srt", () => {
  SandboxRuntimeConfigSchema.parse(toSrtConfig(base(), ctx));
  SandboxRuntimeConfigSchema.parse(toSrtConfig(base({ credentials: [] }), ctx));
});

test("sin credenciales no hay credentials ni tlsTerminate", () => {
  const c = toSrtConfig(base({ credentials: [] }), ctx);
  assert.equal(c.credentials, undefined);
  assert.equal(c.network.tlsTerminate, undefined);
});

for (const d of [
  "*.example.com",
  ".example.com",
  "example.com:443",
  "10.0.0.1",
  "Example.com",
  "https://example.com",
  "example.com/x",
  "localhost",
  "",
]) {
  test(`rechaza el dominio «${d}»`, () => {
    refuses(base({ allowedDomains: [d], credentials: [] }), /dominio/);
  });
}

for (const p of ["repo", "./repo", "~/repo", `${repo}/*`, `${repo}/{a,b}`, `${repo}/../repo`]) {
  test(`rechaza la ruta «${p}»`, () => {
    refuses(base({ readPaths: [p] }), /readPaths/);
  });
}

test("rechaza una ruta que no existe", () => {
  refuses(base({ writeDir: join(togiHome, "workspaces", "nada") }), /no existe/);
});

test("rechaza TOGI_HOME, un ancestro suyo y lo que no está bajo workspaces/", () => {
  for (const p of [togiHome, home, root, join(togiHome, "run"), join(togiHome, "workspaces")]) {
    refuses(base({ readPaths: [p] }), /workspaces/);
    refuses(base({ writeDir: p }), /workspaces/);
  }
});

test("rechaza ~/.ssh y cualquier otra ruta de la carpeta personal, directa o por enlace", () => {
  refuses(base({ readPaths: [join(home, ".ssh")] }), /workspaces/);
  refuses(base({ writeDir: join(home, ".ssh") }), /workspaces/);
  const toSsh = join(togiHome, "workspaces", "enlace-ssh");
  symlinkSync(join(home, ".ssh"), toSsh);
  refuses(base({ readPaths: [toSsh] }), /workspaces/);
  const toHome = join(togiHome, "workspaces", "enlace-home");
  symlinkSync(home, toHome);
  refuses(base({ readPaths: [toHome] }), /workspaces/);
});

test("rechaza una ruta fuera de la carpeta personal que no está bajo workspaces/", () => {
  refuses(base({ readPaths: [agent] }), /workspaces/);
});

test("traduce la ruta ya resuelta, no el enlace", () => {
  const link = join(root, "enlace-repo");
  symlinkSync(repo, link);
  assert.ok(toSrtConfig(base({ readPaths: [link] }), ctx).filesystem.allowRead?.includes(repo));
});

test("la carpeta de Node del constructor se traduce a su allowRead, sin ensanchar", () => {
  const allow = toSrtConfig(base(), ctx).filesystem.allowRead;
  assert.ok(allow?.includes(nodeDir));
  assert.ok(!allow?.includes(dirname(nodeDir)));
  assert.ok(!allow?.includes(home));
});

test("rechaza rutas del entorno que ensanchan la carpeta personal o tocan TOGI_HOME", () => {
  for (const p of [home, root, togiHome, repo, join(root, "no-existe"), "relativa"]) {
    refuses(base(), /runtimePaths/, { ...ctx, runtimePaths: [p] });
  }
});

test("rechaza writeDir dentro de readPaths", () => {
  refuses(base({ readPaths: [join(togiHome, "workspaces", "s1")] }), /writeDir/);
});

test("rechaza una credencial que inyecta en un dominio no permitido", () => {
  refuses(
    base({ credentials: [{ name: "K", injectDomains: ["otro.example.com"] }] }),
    /no está permitido/,
  );
});

test("rechaza variables, tiempo y listas no válidos", () => {
  refuses(base({ allowedEnv: ["A=B"] }), /variable/);
  refuses(
    base({ credentials: [{ name: "a b", injectDomains: ["api.example.com"] }] }),
    /credencial/,
  );
  refuses(base({ timeoutMs: 0 }), /timeoutMs/);
  refuses(base({ readPaths: [] }), /vacío/);
});
