import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { FileKeychain } from "./file-keychain.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "togi-fkc-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("ida y vuelta, y ausente da null", async () => {
  const kc = new FileKeychain(dir);
  assert.equal(await kc.get(), null);
  const key = Uint8Array.from({ length: 32 }, (_, i) => i);
  await kc.create(key);
  assert.deepEqual(await kc.get(), key);
});

test("el fichero queda con permisos 0600", async () => {
  await new FileKeychain(dir).create(new Uint8Array(32));
  const [name] = readdirSync(dir);
  assert.equal(statSync(join(dir, name as string)).mode & 0o777, 0o600);
});

test("create no sobrescribe una clave existente", async () => {
  const kc = new FileKeychain(dir);
  await kc.create(new Uint8Array(32).fill(1));
  await assert.rejects(kc.create(new Uint8Array(32).fill(2)));
  assert.deepEqual(await kc.get(), new Uint8Array(32).fill(1));
});
