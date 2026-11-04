import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  type Actor,
  type BlobStore,
  type DomainError,
  decide,
  VersionConflictError,
} from "@togi/core";
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
let store: SqliteEventStore;
let blobs: FileBlobStore;
const actor: Actor = { kind: "human", userId: "usr_1" };
const clock = () => new Date("2026-11-03T10:00:00Z");
const create = (over: Partial<CreateTaskInput> = {}): CreateTaskInput => ({
  type: "create",
  title: "Filtro",
  description: "d",
  acceptanceCriteria: "criterio",
  risk: "low",
  repo: "r",
  baseBranch: "main",
  source: { kind: "cli" },
  ...over,
});
const handler = (b: BlobStore = blobs) => createHandler({ db, store, blobs: b, clock });
const count = (table: string) =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const state = (n: number) =>
  (db.prepare("SELECT state FROM tasks WHERE number = ?").get(n) as { state: string }).state;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-cmd2-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  store = new SqliteEventStore(db);
  const keys = new DataKeyring(
    db,
    await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } })),
  );
  blobs = new FileBlobStore(p.blobs, keys);
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

test("crear sin criterio, editarlo para añadirlo y enviar: el submit se acepta", async () => {
  const handle = handler();
  await handle(actor, create({ acceptanceCriteria: "" }));
  const edit = await handle(actor, {
    type: "edit",
    number: 1,
    acceptanceCriteria: "ya hay criterio",
  });
  assert.ok("events" in edit);
  assert.equal(edit.events[0]?.streamVersion, 2);
  const submit = await handle(actor, { type: "submit", number: 1 });
  assert.ok("events" in submit, JSON.stringify(submit));
  assert.equal(state(1), "planning");
});

test("submit sin criterio devuelve missing_acceptance_criteria y no escribe", async () => {
  const handle = handler();
  await handle(actor, create({ acceptanceCriteria: "" }));
  const result = await handle(actor, { type: "submit", number: 1 });
  assert.equal((result as DomainError).code, "missing_acceptance_criteria");
  assert.equal(count("events"), 1);
  assert.equal(state(1), "draft");
});

test("editar a vacío borra el campo", async () => {
  const handle = handler();
  await handle(actor, create());
  const edit = await handle(actor, { type: "edit", number: 1, acceptanceCriteria: "  " });
  assert.ok("events" in edit);
  const payload = edit.events[0]?.payload as Record<string, unknown>;
  assert.equal(payload.acceptanceCriteria, null);
  const submit = await handle(actor, { type: "submit", number: 1 });
  assert.equal((submit as DomainError).code, "missing_acceptance_criteria");
});

test("reject guarda el motivo como blob y la proyección queda en rejected", async () => {
  const handle = handler();
  await handle(actor, create());
  const result = await handle(actor, {
    type: "reject",
    number: 1,
    category: "scope",
    text: "fuera de alcance",
  });
  assert.ok("events" in result);
  const payload = result.events[0]?.payload as {
    reason: { category: string; text: Parameters<BlobStore["get"]>[0] };
  };
  const { reason } = payload;
  assert.equal(reason.category, "scope");
  assert.equal(new TextDecoder().decode(await blobs.get(reason.text)), "fuera de alcance");
  assert.equal(state(1), "rejected");
});

test("reject con texto vacío devuelve el mismo invalid_reason que core", async () => {
  const handle = handler();
  await handle(actor, create());
  const result = await handle(actor, { type: "reject", number: 1, category: "scope", text: " " });
  const fromCore = decide(
    {
      exists: true,
      state: "draft",
      title: { hash: "hmac-sha256:t", keyId: "k", dataClass: "task_text" },
      description: null,
      acceptanceCriteria: null,
      risk: "low",
    },
    { type: "reject", actor, at: "", reason: { category: "scope", text: null } },
    { maxProductionLines: 200, maxTotalLines: 500, maxFailedCycles: 3 },
  );
  assert.equal((result as DomainError).code, "invalid_reason");
  assert.deepEqual(result, fromCore);
  assert.equal(count("events"), 1);
});

test("un comando sobre una tarea rechazada devuelve task_final", async () => {
  const handle = handler();
  await handle(actor, create());
  await handle(actor, { type: "reject", number: 1, category: "other", text: "no" });
  const result = await handle(actor, { type: "submit", number: 1 });
  assert.equal((result as DomainError).code, "task_final");
  assert.equal(count("events"), 2);
});

test("un comando sobre una tarea inexistente devuelve task_not_found sin blobs ni eventos", async () => {
  const handle = handler();
  const edit = await handle(actor, { type: "edit", number: 9, description: "x" });
  const reject = await handle(actor, { type: "reject", number: 9, category: "other", text: "x" });
  assert.equal((edit as DomainError).code, "task_not_found");
  assert.equal((reject as DomainError).code, "task_not_found");
  assert.equal(count("events"), 0);
  assert.equal(count("data_keys"), 0);
  assert.equal(existsSync(paths(home).blobs), false);
});

test("si otro proceso escribe entre la reconstrucción y el append, VersionConflictError", async () => {
  await handler()(actor, create());
  const racing: BlobStore = {
    put: async (...args) => {
      await store.append("task:1", 1, [
        { type: "task.edited", schemaVersion: 1, actor, at: clock().toISOString(), payload: {} },
      ]);
      return blobs.put(...args);
    },
    get: blobs.get.bind(blobs),
    shred: blobs.shred.bind(blobs),
  };
  await assert.rejects(
    handler(racing)(actor, { type: "reject", number: 1, category: "other", text: "motivo" }),
    VersionConflictError,
  );
  assert.equal(count("events"), 2); // create + el evento del otro proceso; nada más
  assert.equal(state(1), "draft");
});
