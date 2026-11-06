import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { test } from "node:test";
import type { SandboxSpec } from "@togi/core";
import { deniedRead, SandboxSpecError, toSrtConfig, userTmpDirs } from "./srt-config.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-srt-outside-")));
const home = join(root, "home");
const togiHome = join(home, ".togi");
const repo = join(togiHome, "workspaces", "s1", "repo");
const scratch = join(togiHome, "workspaces", "s1", "scratch");
const agent = join(root, "agent");
const fakeTmp = join(root, "tmp-del-usuario");
for (const d of [repo, scratch, agent, fakeTmp]) mkdirSync(d, { recursive: true });

const spec: SandboxSpec = {
  readPaths: [repo],
  writeDir: scratch,
  allowedDomains: [],
  allowedEnv: ["PATH"],
  credentials: [],
  timeoutMs: 1000,
};
const ctx = { home, togiHome, runtimePaths: [agent], tmpDirs: [fakeTmp] };

test("deniega la lectura de lo compartido, los volúmenes, /tmp y la temporal del usuario", () => {
  const { denyRead } = toSrtConfig(spec, ctx).filesystem;
  for (const p of [home, "/Users", "/Volumes", "/private/tmp", fakeTmp]) {
    assert.ok(denyRead.includes(p), `falta ${p} en ${denyRead.join(", ")}`);
  }
  assert.equal(new Set(denyRead).size, denyRead.length, "sin duplicados");
});

test("/tmp se resuelve a /private/tmp y no queda duplicado", () => {
  const { denyRead } = toSrtConfig(spec, ctx).filesystem;
  assert.ok(!denyRead.includes("/tmp") || denyRead.includes("/private/tmp"));
  assert.equal(denyRead.filter((p) => p === "/private/tmp").length, 1);
});

test("lo que el agente necesita sigue reabierto aunque esté bajo una carpeta denegada", () => {
  const { allowRead, allowWrite } = toSrtConfig(spec, {
    ...ctx,
    tmpDirs: [root],
  }).filesystem;
  for (const p of [repo, scratch, agent]) assert.ok(allowRead?.includes(p), `falta ${p}`);
  assert.deepEqual(allowWrite, [scratch]);
});

test("la temporal del usuario en /var/folders se deniega por su padre, con C/ y 0/", () => {
  // Una carpeta que no es un `T/` de /var/folders se deniega tal cual.
  assert.deepEqual(userTmpDirs(fakeTmp), [fakeTmp]);
  const t = realpathSync(tmpdir());
  const expected = t.startsWith("/private/var/folders/") ? [join(t, "..")] : [t];
  assert.deepEqual(
    userTmpDirs(t).map((p) => realpathSync(p)),
    expected.map((p) => realpathSync(p)),
  );
});

test("denyRead sale siempre en el mismo orden, sea /tmp o /private/tmp la temporal", () => {
  // En Linux la temporal del usuario es /tmp; en macOS, /var/folders. El orden no depende de eso.
  const a = deniedRead(home, ["/tmp"]);
  const b = deniedRead(home, ["/private/tmp"]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.slice(0, 4), [home, "/Users", "/Volumes", "/private/tmp"]);
  assert.equal(new Set(a).size, a.length, "sin duplicados");
  const own = deniedRead(home, [fakeTmp]);
  assert.deepEqual(own.slice(0, 5), [home, "/Users", "/Volumes", "/private/tmp", fakeTmp]);
});

test("la carpeta temporal que se deniega nunca es la raíz del disco", () => {
  assert.throws(() => deniedRead(home, ["/"]), SandboxSpecError);
  assert.throws(() => toSrtConfig(spec, { ...ctx, tmpDirs: ["/"] }), SandboxSpecError);
  // TMPDIR=/ : la temporal que calcula el código tampoco puede acabar denegando «/».
  assert.throws(() => toSrtConfig(spec, { ...ctx, tmpDirs: userTmpDirs("/") }), SandboxSpecError);
  // Con la temporal real de este equipo (sin inyectar) tampoco.
  const real = toSrtConfig(spec, { home, togiHome, runtimePaths: [agent] });
  for (const entry of [
    ...toSrtConfig(spec, ctx).filesystem.denyRead,
    ...real.filesystem.denyRead,
  ]) {
    const p = typeof entry === "string" ? entry : entry.path;
    assert.notEqual(p, parse(p).root, `deniega ${p}`);
  }
});
