import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createInstallRunner, type InstallRequest, installOrder } from "./install-runner.ts";

const FAKE = join(import.meta.dirname, "testing", "fake-install-worker.ts");

let root: string;
let request: InstallRequest;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "togi-install-"));
  const dir = join(root, "workspaces", "wsp_1");
  mkdirSync(join(dir, "tree"), { recursive: true });
  request = {
    paths: { tree: join(dir, "tree"), gitDir: join(dir, "git") },
    profile: { install: "ok", registry: ["registry.npmjs.org"] },
    runtimePaths: ["/opt/node/bin"],
    timeoutMs: 30_000,
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const runner = createInstallRunner({ workerEntry: FAKE, graceMs: 100 });
const run = (install: string, over: Partial<InstallRequest> = {}) =>
  runner.run({ ...request, profile: { ...request.profile, install }, ...over });

test("la orden: el árbol escribible, el bloqueo de pnpm, solo el registro y sin credenciales", () => {
  const order = installOrder(
    { ...request, profile: { install: "pnpm install --frozen-lockfile", registry: ["a.b"] } },
    "ins_x",
  );
  const dir = join(root, "workspaces", "wsp_1");
  assert.deepEqual(order, {
    type: "install",
    sessionId: "ins_x",
    spec: {
      readPaths: [],
      writeDir: join(dir, "install"),
      workTree: join(dir, "tree"),
      pnpmLocks: true,
      allowedDomains: ["a.b"],
      allowedEnv: ["PATH"],
      credentials: [],
      timeoutMs: 30_000,
    },
    workspacesRoot: join(root, "workspaces"),
    runtimePaths: ["/opt/node/bin"],
    argv: ["pnpm", "install", "--frozen-lockfile"],
  });
});

test("cada resultado del trabajador se traduce a un resultado cerrado", async () => {
  assert.deepEqual(await run("ok"), { status: "ok", output: "" });
  assert.deepEqual(await run("timeout"), { status: "timeout", output: "" });
  assert.deepEqual(await run("sandbox"), { status: "sandbox_error", output: "" });
  assert.deepEqual(await run("cancelled"), { status: "sandbox_error", output: "" });
  assert.deepEqual(await run("die"), { status: "sandbox_error", output: "" });
  const failed = await run("fail");
  assert.equal(failed.status, "failed");
  assert.equal(failed.status === "failed" && failed.exitCode, 2);
});

test("la salida queda acotada a las últimas líneas", async () => {
  const { output } = await run("fail");
  const lines = output.split("\n");
  assert.equal(lines.length, 20);
  assert.equal(lines.at(-1), "instalación: línea 29");
});

test("un evento del trabajador no se registra ni cambia el resultado", async () => {
  assert.deepEqual(await run("event"), { status: "ok", output: "" });
});

test("un error del protocolo cierra el trabajador al momento, sin esperar al tope", async () => {
  const started = Date.now();
  assert.deepEqual(await run("error"), { status: "sandbox_error", output: "" });
  assert.ok(Date.now() - started < 10_000);
});

test("si el trabajador no contesta, el tope de tiempo lo para", async () => {
  assert.deepEqual(await run("hang", { timeoutMs: 200 }), { status: "timeout", output: "" });
  assert.deepEqual(await run("other", { timeoutMs: 200 }), { status: "timeout", output: "" });
});

test("un comando que no es exacto no llega al trabajador", async () => {
  assert.deepEqual(await run("ok; rm -rf ~"), { status: "sandbox_error", output: "" });
});

test("la carpeta desechable se vacía antes de instalar, aunque quede con 0555", async () => {
  const scratch = join(root, "workspaces", "wsp_1", "install");
  mkdirSync(join(scratch, "store"), { recursive: true });
  writeFileSync(join(scratch, "store", "viejo"), "x");
  chmodSync(join(scratch, "store"), 0o555);
  assert.equal((await run("ok")).status, "ok");
  assert.ok(existsSync(scratch));
  assert.equal(existsSync(join(scratch, "store")), false);
});
