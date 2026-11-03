import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { type Actor, ADMIN_STREAM, type StoredEvent } from "@togi/core";
import type Database from "better-sqlite3";
import { paths } from "../config/app.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { erase } from "./erase.ts";
import { FileBlobStore } from "./file-blob-store.ts";

let home: string;
let db: Database.Database;
let deps: Parameters<typeof erase>[0];
const text = Buffer.from("descripción con datos personales");
const actor: Actor = { kind: "human", userId: "usr_1" };

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-erase-"));
  const p = paths(home);
  const keychain = selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } });
  db = openEventDatabase(p.database);
  const keys = new DataKeyring(db, await loadOrCreateMasterKey(keychain));
  deps = { events: new SqliteEventStore(db), keys, blobs: new FileBlobStore(p.blobs, keys) };
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

const all = async (): Promise<StoredEvent[]> => {
  const out: StoredEvent[] = [];
  for await (const e of deps.events.readAll()) out.push(e);
  return out;
};

test("erase deja data.erased sin contenido, la cadena verifica y el blob ya no se lee", async () => {
  const ref = await deps.blobs.put(text, "task_text", 1);
  assert.equal(await erase(deps, 1, "task_text", "supresión RGPD", actor), ref.keyId);
  const [event, ...rest] = await all();
  assert.equal(rest.length, 0);
  assert.equal(event?.stream, ADMIN_STREAM);
  assert.equal(event?.type, "data.erased");
  assert.deepEqual(event?.actor, actor);
  assert.deepEqual(event?.payload, {
    keyId: ref.keyId,
    taskId: 1,
    dataClass: "task_text",
    reason: "supresión RGPD",
  });
  assert.ok(!JSON.stringify(event).includes(text.toString()));
  assert.deepEqual(await deps.events.verify(), { ok: true });
  await assert.rejects(deps.blobs.get(ref));
});

test("erase sin clave no escribe ningún evento", async () => {
  await deps.blobs.put(text, "task_text", 1);
  assert.equal(await erase(deps, 2, "task_text", "x", actor), null);
  assert.equal(await erase(deps, 1, "prompt", "x", actor), null);
  assert.equal((await all()).length, 0);
});

test("dos erase seguidos encadenan versiones del stream admin", async () => {
  await deps.blobs.put(text, "task_text", 1);
  await deps.blobs.put(text, "prompt", 1);
  await erase(deps, 1, "task_text", "a", actor);
  await erase(deps, 1, "prompt", "b", actor);
  assert.deepEqual(
    (await all()).map((e) => e.streamVersion),
    [1, 2],
  );
});

for (const [name, sql] of [
  [
    "falla el append",
    "CREATE TRIGGER t BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'x'); END",
  ],
  [
    "falla el borrado de la clave",
    "CREATE TRIGGER t BEFORE DELETE ON data_keys BEGIN SELECT RAISE(ABORT, 'x'); END",
  ],
] as const) {
  test(`si ${name}, la clave sigue, el blob se lee y no queda evento`, async () => {
    const ref = await deps.blobs.put(text, "task_text", 1);
    db.exec(sql);
    await assert.rejects(erase(deps, 1, "task_text", "x", actor), /x/);
    db.exec("DROP TRIGGER t");
    assert.deepEqual(Buffer.from(await deps.blobs.get(ref)), text);
    assert.equal((await all()).length, 0);
  });
}
