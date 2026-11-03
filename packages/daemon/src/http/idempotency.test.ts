import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { NewEvent, StoredEvent } from "@togi/core";
import type Database from "better-sqlite3";
import { hashToken } from "../auth/tokens.ts";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { createHandler } from "../commands/handle-command.ts";
import { paths } from "../config/app.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { createApp } from "./app.ts";

/** Falla una vez DESPUÉS de ejecutar `within`: prueba que la transacción entera se revierte. */
class FailsOnce extends SqliteEventStore {
  armed = false;
  override appendWithin(
    stream: string,
    expected: number,
    events: NewEvent[],
    within: (stored: StoredEvent[], db: Database.Database) => void,
  ): StoredEvent[] {
    return super.appendWithin(stream, expected, events, (stored, tx) => {
      within(stored, tx);
      if (this.armed) {
        this.armed = false;
        throw new Error("fallo tras el append");
      }
    });
  }
}

let home: string;
let db: Database.Database;
let store: FailsOnce;
let app: ReturnType<typeof createApp>;
const NEW = { title: "Filtro", acceptanceCriteria: "criterio", risk: "low", repo: "o/r" };

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-idem-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  for (const n of [1, 2]) {
    db.prepare("INSERT INTO users VALUES (?, ?, ?)").run(`usr_${n}`, `u${n}`, "now");
    db.prepare("INSERT INTO tokens VALUES (?, ?, ?)").run(hashToken(`tok-${n}`), `usr_${n}`, "now");
  }
  const masterKey = await loadOrCreateMasterKey(
    selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } }),
  );
  const blobs = new FileBlobStore(p.blobs, new DataKeyring(db, masterKey));
  store = new FailsOnce(db);
  app = createApp(db, createHandler({ db, store, blobs }));
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

const post = (body: unknown, key?: string, user = 1) =>
  app.request("/v1/tasks", {
    method: "POST",
    headers: {
      authorization: `Bearer tok-${user}`,
      "content-type": "application/json",
      ...(key === undefined ? {} : { "idempotency-key": key }),
    },
    body: JSON.stringify(body),
  });
const count = (table: string) =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

test("misma clave y mismo cuerpo: misma respuesta, status y ETag, sin crear otra tarea", async () => {
  const first = await post(NEW, "k-1");
  const { title, ...rest } = NEW;
  const second = await post({ ...rest, title }, "k-1"); // otro orden de claves
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(second.headers.get("etag"), first.headers.get("etag"));
  assert.deepEqual(await second.json(), await first.json());
  assert.equal(count("tasks"), 1);
  assert.equal(count("events"), 1);
});

test("la repetición devuelve la respuesta original aunque la tarea haya cambiado", async () => {
  const first = (await (await post(NEW, "k-1")).json()) as { number: number };
  await app.request(`/v1/tasks/${first.number}/submit`, {
    method: "POST",
    headers: { authorization: "Bearer tok-1", "if-match": '"1"' },
  });
  const again = await post(NEW, "k-1");
  assert.equal(again.headers.get("etag"), '"1"');
  assert.equal(((await again.json()) as { state: string }).state, "draft");
});

test("la misma clave con otro cuerpo da 422 idempotency_key_reused", async () => {
  await post(NEW, "k-1");
  const res = await post({ ...NEW, title: "Otro" }, "k-1");
  assert.equal(res.status, 422);
  assert.equal(((await res.json()) as { code: string }).code, "idempotency_key_reused");
  assert.equal(count("tasks"), 1);
});

test("la misma clave de otro usuario no choca", async () => {
  const a = (await (await post(NEW, "k-1", 1)).json()) as { number: number };
  const bRes = await post(NEW, "k-1", 2);
  assert.equal(bRes.status, 201);
  assert.notEqual(((await bRes.json()) as { number: number }).number, a.number);
  assert.equal(count("tasks"), 2);
});

test("si el append falla no queda la clave y un reintento crea la tarea", async () => {
  store.armed = true;
  const failed = await post(NEW, "k-1");
  assert.equal(failed.status, 500);
  assert.equal(count("idempotency_keys"), 0);
  assert.equal(count("tasks"), 0);
  assert.equal((await post(NEW, "k-1")).status, 201);
  assert.equal(count("tasks"), 1);
  assert.equal(count("idempotency_keys"), 1);
});

test("una clave con formato inválido da 400", async () => {
  for (const key of ["con espacios", "a".repeat(129), "ñ"]) {
    const res = await post(NEW, key);
    assert.equal(res.status, 400, key);
    assert.equal(((await res.json()) as { code: string }).code, "invalid_idempotency_key");
  }
  assert.equal(count("tasks"), 0);
});
