import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pnpmLockDir } from "./srt-config.ts";
import { SrtSandbox } from "./srt-sandbox.ts";

// Con el srt real: la instalación (ADR-011 §2-§4) corre en el árbol del clon, que puede escribir; no
// ve el directorio de git de al lado; y de /tmp solo puede escribir el bloqueo de pnpm.

const skip = process.platform === "darwin" ? undefined : "srt solo funciona en macOS (Seatbelt)";

test("dentro de srt, el árbol se escribe, el git de al lado no se ve y de /tmp solo el bloqueo", {
  skip,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-tree-srt-")));
  const home = join(root, "home");
  const togiHome = join(home, ".togi");
  const tree = join(togiHome, "workspaces", "wsp_1", "tree");
  const gitDir = join(togiHome, "workspaces", "wsp_1", "git");
  const scratch = join(togiHome, "workspaces", "wsp_1.install");
  for (const d of [tree, gitDir, scratch]) mkdirSync(d, { recursive: true });
  writeFileSync(join(gitDir, "config"), "[core]\n");
  const uid = process.getuid?.() ?? 0;
  const mark = `togi-${randomUUID()}`;
  const inLock = join(pnpmLockDir(uid), mark);
  const inTmp = join("/private/tmp", mark);
  mkdirSync(pnpmLockDir(uid), { recursive: true, mode: 0o700 }); // como lo deja pnpm fuera del sandbox
  const sandbox = new SrtSandbox({ togiHome, home, runtimePaths: [] });
  const spec = {
    readPaths: [],
    writeDir: scratch,
    workTree: tree,
    pnpmLocks: true,
    allowedDomains: [],
    allowedEnv: ["PATH"],
    credentials: [],
    timeoutMs: 20_000,
  };
  const sh = (script: string) => sandbox.run(spec, ["/bin/sh", "-c", script]);
  try {
    const pwd = await sh("pwd && mkdir -p node_modules/x && echo hola > node_modules/x/f");
    assert.equal(pwd.exitCode, 0, pwd.stderr);
    assert.equal(pwd.stdout.trim(), tree);
    assert.ok(existsSync(join(tree, "node_modules", "x", "f")));

    assert.notEqual((await sh(`cat "${join(gitDir, "config")}"`)).exitCode, 0);
    assert.notEqual((await sh(`echo x > "${join(gitDir, "hooks")}"`)).exitCode, 0);
    assert.equal(existsSync(join(gitDir, "hooks")), false);

    const lock = await sh(`echo x > "${inLock}"`);
    assert.equal(lock.exitCode, 0, lock.stderr);
    assert.ok(existsSync(inLock));
    assert.notEqual((await sh(`echo x > "${inTmp}"`)).exitCode, 0);
    assert.equal(existsSync(inTmp), false);

    const unlisted = await sandbox.run({ ...spec, pnpmLocks: false }, [
      "/bin/sh",
      "-c",
      `echo x > "${inLock}.2"`,
    ]);
    assert.notEqual(unlisted.exitCode, 0);
  } finally {
    rmSync(inLock, { force: true });
    rmSync(`${inLock}.2`, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
