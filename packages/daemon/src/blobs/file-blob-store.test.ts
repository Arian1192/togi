import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type Database from "better-sqlite3";
import { paths } from "../config/app.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { openEventDatabase } from "../store/database.ts";
import { FileBlobStore } from "./file-blob-store.ts";

let home: string;
let db: Database.Database;
let master: Uint8Array;
let store: FileBlobStore;
const text = Buffer.from("descripción con datos personales");

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-blobs-"));
  const p = paths(home);
  const keychain = selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } });
  master = await loadOrCreateMasterKey(keychain);
  db = openEventDatabase(p.database);
  store = new FileBlobStore(p.blobs, new DataKeyring(db, master));
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

const blobPath = (ref: { keyId: string; hash: string }) =>
  join(paths(home).blobs, ref.keyId, ref.hash.slice("hmac-sha256:".length));

test("ida y vuelta", async () => {
  const ref = await store.put(text, "task_text", 1);
  assert.deepEqual(Buffer.from(await store.get(ref)), text);
  assert.notDeepEqual(await readFile(blobPath(ref)), text);
});

test("mismo contenido, tarea y clase: mismo identificador y misma clave", async () => {
  const a = await store.put(text, "task_text", 1);
  const b = await store.put(text, "task_text", 1);
  assert.deepEqual(a, b);
  assert.equal(readdirSync(join(paths(home).blobs, a.keyId)).length, 1);
  assert.equal((db.prepare("SELECT count(*) AS n FROM data_keys").get() as { n: number }).n, 1);
});

test("otra tarea u otra clase dan otro identificador y otra clave", async () => {
  const base = await store.put(text, "task_text", 1);
  for (const other of [await store.put(text, "task_text", 2), await store.put(text, "prompt", 1)]) {
    assert.notEqual(other.hash, base.hash);
    assert.notEqual(other.keyId, base.keyId);
  }
});

test("el identificador no es el SHA-256 simple del contenido", async () => {
  const ref = await store.put(text, "task_text", 1);
  assert.match(ref.hash, /^hmac-sha256:[0-9a-f]{64}$/);
  assert.notEqual(ref.hash.slice(12), createHash("sha256").update(text).digest("hex"));
});

test("un blob alterado en disco no se descifra", async () => {
  const ref = await store.put(text, "task_text", 1);
  const bytes = await readFile(blobPath(ref));
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
  writeFileSync(blobPath(ref), bytes);
  await assert.rejects(store.get(ref));
});

test("un blob movido a otra tarea no se descifra", async () => {
  const a = await store.put(text, "task_text", 1);
  const b = await store.put(Buffer.from("otro"), "task_text", 2);
  const moved = { ...a, keyId: b.keyId };
  renameSync(blobPath(a), blobPath(moved));
  await assert.rejects(store.get(moved));
});

test("una clave envuelta copiada a otra fila no se desenvuelve", async () => {
  const ring = new DataKeyring(db, master);
  const { keyId } = ring.keyFor(1, "task_text");
  const row = db.prepare("SELECT wrapped_key FROM data_keys WHERE key_id = ?").get(keyId) as {
    wrapped_key: Buffer;
  };
  const insert = db.prepare(
    "INSERT INTO data_keys (key_id, task_id, data_class, wrapped_key, created_at) VALUES (?, ?, ?, ?, 'x')",
  );
  insert.run("key_copia1", 2, "task_text", row.wrapped_key);
  insert.run("key_copia2", 1, "prompt", row.wrapped_key);
  assert.throws(() => ring.unwrap("key_copia1"));
  assert.throws(() => ring.unwrap("key_copia2"));
});

test("otra clave maestra no desenvuelve nada y un keyId inexistente falla", async () => {
  const ref = await store.put(text, "task_text", 1);
  assert.throws(() => new DataKeyring(db, randomBytes(32)).unwrap(ref.keyId));
  await assert.rejects(store.get({ ...ref, keyId: `key_${"0".repeat(32)}` }), /inexistente/);
});

test("ficheros 0600 y directorios 0700", async () => {
  const ref = await store.put(text, "task_text", 1);
  const mode = (path: string) => statSync(path).mode & 0o777;
  assert.equal(mode(blobPath(ref)), 0o600);
  assert.equal(mode(join(paths(home).blobs, ref.keyId)), 0o700);
  assert.equal(mode(paths(home).blobs), 0o700);
});
