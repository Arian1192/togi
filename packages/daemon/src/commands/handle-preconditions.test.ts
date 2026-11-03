import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { Actor, BlobStore } from "@togi/core";
import type Database from "better-sqlite3";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { paths } from "../config/app.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { type CreateTaskInput, createHandler } from "./handle-command.ts";

let home: string;
let db: Database.Database;
let handle: ReturnType<typeof createHandler>;
let puts = 0;
const actor: Actor = { kind: "human", userId: "usr_1" };
const create: CreateTaskInput = {
  type: "create",
  title: "Filtro",
  description: "d",
  acceptanceCriteria: "criterio",
  risk: "low",
  repo: "r",
  baseBranch: "main",
  source: { kind: "cli" },
};
const count = (table: string) =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-pre-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  const keys = new DataKeyring(
    db,
    await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } })),
  );
  const files = new FileBlobStore(p.blobs, keys);
  puts = 0;
  const blobs: BlobStore = {
    put: (...args) => {
      puts += 1;
      return files.put(...args);
    },
    get: (ref) => files.get(ref),
    shred: (keyId) => files.shred(keyId),
  };
  handle = createHandler({ db, store: new SqliteEventStore(db), blobs });
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

test("ifMatch con la versión actual aplica el comando", async () => {
  await handle(actor, create);
  const res = await handle(actor, { type: "edit", number: 1, title: "Nuevo" }, { ifMatch: 1 });
  assert.ok("events" in res);
  assert.equal(res.events[0]?.streamVersion, 2);
});

test("ifMatch viejo da precondition_failed con la versión actual y no escribe nada", async () => {
  await handle(actor, create);
  const written = puts;
  const events = count("events");
  const res = await handle(actor, { type: "edit", number: 1, description: "x" }, { ifMatch: 0 });
  assert.deepEqual(res, { kind: "precondition_failed", current: 1 });
  assert.equal(puts, written);
  assert.equal(count("events"), events);
});

test("sobre una tarea inexistente gana task_not_found al ifMatch", async () => {
  const res = await handle(actor, { type: "submit", number: 9 }, { ifMatch: 3 });
  assert.deepEqual(res, {
    kind: "domain_error",
    code: "task_not_found",
    message: (res as { message: string }).message,
  });
});

test("correlationId se estampa en los eventos de create y de modify", async () => {
  const created = await handle(actor, create, { correlationId: "req-1" });
  assert.ok("events" in created);
  assert.equal(created.events[0]?.correlationId, "req-1");
  const edited = await handle(
    actor,
    { type: "edit", number: 1, title: "Otro" },
    { ifMatch: 1, correlationId: "req-2" },
  );
  assert.ok("events" in edited);
  assert.equal(edited.events[0]?.correlationId, "req-2");
  const stored = db.prepare("SELECT correlation_id FROM events ORDER BY seq").all();
  assert.deepEqual(stored, [{ correlation_id: "req-1" }, { correlation_id: "req-2" }]);
});

test("sin correlationId los eventos no lo llevan", async () => {
  const res = await handle(actor, create);
  assert.ok("events" in res);
  assert.equal("correlationId" in (res.events[0] ?? {}), false);
});
