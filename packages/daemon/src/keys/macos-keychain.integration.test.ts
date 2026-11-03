import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { APP } from "../config/app.ts";
import { MacosKeychain } from "./macos-keychain.ts";

const FLAG = `${APP.envPrefix}TEST_REAL_KEYCHAIN`;
const enabled = process.platform === "darwin" && process.env[FLAG] === "1";

test(`Llavero real con llavero temporal (solo darwin y ${FLAG}=1)`, {
  skip: !enabled && `requiere darwin y ${FLAG}=1`,
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), `${APP.name}-kc-`));
  const path = join(dir, "test.keychain-db");
  execFileSync("security", ["create-keychain", "-p", randomBytes(8).toString("hex"), path]);
  try {
    const kc = new MacosKeychain(join(dir, "home"), undefined, path);
    assert.equal(await kc.get(), null);
    const key = randomBytes(32);
    await kc.create(key);
    assert.deepEqual(Buffer.from((await kc.get()) as Uint8Array), key);
    await assert.rejects(kc.create(randomBytes(32)), { code: 45 });
    assert.deepEqual(Buffer.from((await kc.get()) as Uint8Array), key);
  } finally {
    execFileSync("security", ["delete-keychain", path]);
    rmSync(dir, { recursive: true, force: true });
  }
});
