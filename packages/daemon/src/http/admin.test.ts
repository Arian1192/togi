import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
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

let home: string;
let db: Database.Database;
let app: ReturnType<typeof createApp>;
const AUTH = { authorization: "Bearer tok" };
const NEW = { title: "Filtro", acceptanceCriteria: "criterio", risk: "low", repo: "o/r" };

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-admin-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  db.prepare("INSERT INTO users VALUES ('usr_1', 'owner', 'now')").run();
  db.prepare("INSERT INTO tokens VALUES (?, 'usr_1', 'now')").run(hashToken("tok"));
  const masterKey = await loadOrCreateMasterKey(
    selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } }),
  );
  const blobs = new FileBlobStore(p.blobs, new DataKeyring(db, masterKey));
  const store = new SqliteEventStore(db);
  app = createApp(db, createHandler({ db, store, blobs }), { store, blobs });
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

const verify = (headers: Record<string, string> = AUTH) =>
  app.request("/v1/admin/verify-log", { method: "POST", headers });
const create = () =>
  app.request("/v1/tasks", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify(NEW),
  });

test("verify-log en verde con el log íntegro", async () => {
  for (let i = 0; i < 3; i++) await create();
  const res = await verify();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("tras manipular un evento devuelve el brokenAt exacto", async () => {
  for (let i = 0; i < 3; i++) await create();
  db.exec("DROP TRIGGER events_no_update");
  db.prepare("UPDATE events SET payload = '{}' WHERE seq = 2").run();
  const res = await verify();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: false, brokenAt: 2 });
});

test("sin token, 401 en verify-log y en las rutas existentes", async () => {
  assert.equal((await verify({})).status, 401);
  assert.equal((await app.request("/v1/health")).status, 401);
});

test("sin consultas configuradas responde 503", async () => {
  const res = await createApp(db).request("/v1/admin/verify-log", {
    method: "POST",
    headers: AUTH,
  });
  assert.equal(res.status, 503);
});
