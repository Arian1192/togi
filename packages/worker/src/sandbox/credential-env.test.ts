import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RunReaper } from "./reap.ts";
import { type SrtManager, SrtSandbox } from "./srt-sandbox.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-credenv-")));
const repo = join(root, "togi", "workspaces", "s1", "repo");
const scratch = join(root, "togi", "workspaces", "s1", "scratch");
mkdirSync(repo, { recursive: true });
mkdirSync(scratch, { recursive: true });

// Por partes: ningún detector de secretos lo ve como una clave en el código fuente.
const REAL = ["valor", "real", "de", "prueba"].join("-");
const KEY = "TOGI_CREDENV_KEY";

/** srt simulado y sin limpieza: aquí solo importa qué entorno se le da al hijo. */
const manager: SrtManager = {
  isSupportedPlatform: () => true,
  async initialize() {},
  async wrapWithSandboxArgv(command) {
    return { argv: ["/bin/sh", "-c", command] };
  },
  async reset() {},
};
const noReaper = (): RunReaper => ({
  env: {},
  fd: "ignore",
  async begin() {},
  watch() {},
  async sweep() {},
});

test("el hijo no recibe el valor real de una credencial enmascarada, aunque esté permitida", async () => {
  process.env[KEY] = REAL;
  process.env.TOGI_CREDENV_PLAIN = "visible";
  try {
    const sandbox = new SrtSandbox({
      togiHome: join(root, "togi"),
      runtimePaths: [],
      home: join(root, "home"),
      manager,
      reaper: noReaper,
    });
    const r = await sandbox.run(
      {
        readPaths: [repo],
        writeDir: scratch,
        allowedDomains: ["api.example.com"],
        allowedEnv: ["PATH", KEY, "TOGI_CREDENV_PLAIN"],
        credentials: [{ name: KEY, injectDomains: ["api.example.com"] }],
        timeoutMs: 5000,
      },
      ["/usr/bin/env"],
    );
    assert.ok(!r.stdout.includes(REAL), "el valor real llegó al entorno del hijo");
    assert.ok(!r.stdout.includes(`${KEY}=`), "la variable enmascarada llegó al hijo");
    assert.match(r.stdout, /TOGI_CREDENV_PLAIN=visible/); // las demás permitidas siguen llegando
  } finally {
    delete process.env[KEY];
    delete process.env.TOGI_CREDENV_PLAIN;
  }
});

/** Ejecuta el trabajador de mentira; `initial` pone además el valor en su entorno inicial. */
function standIn(where: "initial" | "runtime"): Promise<string> {
  const script = join(import.meta.dirname, "testing", "stand-in-worker.ts");
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  if (where === "initial") env.TOGI_STANDIN_KEY = REAL;
  const child = spawn(process.execPath, [script], { env, stdio: ["pipe", "pipe", "inherit"] });
  let out = "";
  child.stdout.on("data", (d) => {
    out += d;
  });
  child.stdin.end(REAL);
  return new Promise((resolve) => child.on("close", () => resolve(out)));
}

const darwin = process.platform === "darwin" ? undefined : "SrtSandbox solo funciona en macOS";

test("control positivo: con el valor en el entorno inicial del trabajador, el agente lo lee", {
  skip: darwin,
}, async () => {
  assert.equal(await standIn("initial"), "ALLOWED");
});

test("con el valor puesto en tiempo de ejecución, como en el trabajador real, el agente no lo lee", {
  skip: darwin,
}, async () => {
  assert.equal(await standIn("runtime"), "DENIED");
});

test.after(() => rmSync(root, { recursive: true, force: true }));
