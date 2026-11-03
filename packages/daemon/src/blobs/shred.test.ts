import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
let store: FileBlobStore;
const text = Buffer.from("descripción con datos personales");

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-shred-"));
  const p = paths(home);
  const keychain = selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } });
  db = openEventDatabase(p.database);
  store = new FileBlobStore(p.blobs, new DataKeyring(db, await loadOrCreateMasterKey(keychain)));
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

const fileBytes = (): Buffer[] =>
  [paths(home).database, `${paths(home).database}-wal`].map((f) =>
    existsSync(f) ? readFileSync(f) : Buffer.alloc(0),
  );

test("get falla tras shred y se borra el directorio del blob", async () => {
  const ref = await store.put(text, "task_text", 1);
  await store.shred(ref.keyId);
  await assert.rejects(store.get(ref), /inexistente o destruida/);
  assert.equal(existsSync(join(paths(home).blobs, ref.keyId)), false);
});

test("los bytes de la clave envuelta no quedan en la base ni en el WAL", async () => {
  const ref = await store.put(text, "task_text", 1);
  const { wrapped_key } = db
    .prepare("SELECT wrapped_key FROM data_keys WHERE key_id = ?")
    .get(ref.keyId) as { wrapped_key: Buffer };
  assert.ok(
    fileBytes().some((b) => b.includes(wrapped_key)),
    "la prueba no vería la clave ni antes del borrado",
  );
  await store.shred(ref.keyId);
  assert.ok(fileBytes().every((b) => !b.includes(wrapped_key)));
});

test("shred es idempotente, no toca otras claves y rechaza ids inválidos", async () => {
  const a = await store.put(text, "task_text", 1);
  const b = await store.put(text, "task_text", 2);
  await store.shred(a.keyId);
  await store.shred(a.keyId);
  assert.deepEqual(Buffer.from(await store.get(b)), text);
  await assert.rejects(store.shred("../fuera"), /inválido/);
});
