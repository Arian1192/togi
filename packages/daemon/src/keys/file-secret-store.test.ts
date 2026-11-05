import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FileSecretStore } from "./file-secret-store.ts";

test("set sustituye, has/get/delete funcionan y el fichero es 0600", async () => {
  const home = join(mkdtempSync(join(tmpdir(), "togi-fss-")), "h");
  const store = new FileSecretStore(home);
  assert.equal(await store.has("api-key"), false);
  assert.equal(await store.get("api-key"), null);
  await store.set("api-key", "secret-one-1234");
  await store.set("api-key", "secret-two-1234");
  assert.equal(await store.get("api-key"), "secret-two-1234");
  assert.equal(await store.has("subscription"), false);
  assert.equal(statSync(join(home, "togi-agent-api-key.secret")).mode & 0o777, 0o600);
  await store.delete("api-key");
  await store.delete("api-key");
  assert.equal(await store.has("api-key"), false);
});
