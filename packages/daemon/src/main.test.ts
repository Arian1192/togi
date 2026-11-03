import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { paths } from "./config/app.ts";
import { socketClient } from "./testing/socket-client.ts";

const MAIN = join(import.meta.dirname, "main.ts");

let root: string;
before(() => {
  root = mkdtempSync(join(tmpdir(), "togi-main-"));
});
after(() => rmSync(root, { recursive: true, force: true }));

function launch(home: string): ChildProcess {
  return spawn(process.execPath, [MAIN], {
    env: { ...process.env, TOGI_HOME: home, TOGI_KEYCHAIN: "file" },
    stdio: ["ignore", "ignore", "pipe"],
  });
}

const exited = (child: ChildProcess) =>
  new Promise<{ code: number | null; stderr: string }>((resolve) => {
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("exit", (code) => resolve({ code, stderr }));
  });

async function health(home: string) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      return await socketClient(home)("GET", "/v1/health");
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  test(`${signal} cierra el daemon, quita el socket y sale con 0`, async () => {
    const home = join(root, signal);
    const child = launch(home);
    const done = exited(child);
    const res = await health(home);
    assert.equal(res.status, 200);
    assert.equal(res.json.pid, child.pid);
    assert.ok(existsSync(paths(home).socket));
    child.kill(signal);
    assert.equal((await done).code, 0);
    assert.ok(!existsSync(paths(home).socket));
  });
}

test("si falla el arranque, escribe el error en stderr y sale con 1", async () => {
  const file = join(root, "no-es-un-directorio");
  writeFileSync(file, "");
  const child = launch(join(file, "home"));
  const { code, stderr } = await exited(child);
  assert.equal(code, 1);
  assert.match(stderr, /\S/);
});
