import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  type Actor,
  type BlobStore,
  type DomainError,
  domainError,
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
import { type CreateTaskInput, createHandler, type HandlerDeps } from "./handle-command.ts";

let home: string;
let db: Database.Database;
let store: SqliteEventStore;
let keys: DataKeyring;
let blobs: FileBlobStore;
const actor: Actor = { kind: "human", userId: "usr_1" };
const clock = () => new Date("2026-11-03T10:00:00Z");
const input = (over: Partial<CreateTaskInput> = {}): CreateTaskInput => ({
  type: "create",
  title: "Filtro por fecha",
  description: "Filtrar el listado",
  acceptanceCriteria: "Se ve solo el rango",
  risk: "low",
  repo: "r",
  baseBranch: "main",
  source: { kind: "cli" },
  ...over,
});
const handler = (over: Partial<HandlerDeps> = {}) =>
  createHandler({ db, store, blobs, clock, ...over });
const count = (table: string) =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const rejecting = () => domainError("invalid_state", "no");

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-cmd-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  store = new SqliteEventStore(db);
  keys = new DataKeyring(
    db,
    await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } })),
  );
  blobs = new FileBlobStore(p.blobs, keys);
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

test("create guarda la tarea en el log y en tasks con números 1 y 2", async () => {
  const handle = handler();
  const first = await handle(actor, input());
  const second = await handle(actor, input({ title: "Otra" }));
  assert.ok("number" in first && "number" in second);
  assert.deepEqual([first.number, second.number], [1, 2]);
  assert.equal(first.events[0]?.stream, "task:1");
  assert.equal(first.events[0]?.at, "2026-11-03T10:00:00.000Z");
  const rows = db.prepare("SELECT number, title, state FROM tasks ORDER BY number").all() as {
    number: number;
    title: string;
    state: string;
  }[];
  assert.deepEqual(
    rows.map((r) => [r.number, r.state]),
    [
      [1, "draft"],
      [2, "draft"],
    ],
  );
  for (const [row, plain] of [
    [rows[0], "Filtro por fecha"],
    [rows[1], "Otra"],
  ] as const) {
    assert.ok(row !== undefined && !row.title.includes(plain));
    const ref = JSON.parse(row.title) as Parameters<BlobStore["get"]>[0];
    assert.equal(new TextDecoder().decode(await blobs.get(ref)), plain);
  }
  assert.equal(count("events"), 2);
});

test("los textos se leen desde sus blobs con las claves de esa tarea", async () => {
  await handler()(actor, input());
  const result = await handler()(actor, input());
  assert.ok("number" in result);
  const payload = result.events[0]?.payload as {
    description: Parameters<BlobStore["get"]>[0];
    acceptanceCriteria: Parameters<BlobStore["get"]>[0];
  };
  assert.equal(
    new TextDecoder().decode(await blobs.get(payload.description)),
    "Filtrar el listado",
  );
  assert.equal(
    new TextDecoder().decode(await blobs.get(payload.acceptanceCriteria)),
    "Se ve solo el rango",
  );
  assert.equal(payload.description.keyId, keys.find(2, "task_text"));
  assert.notEqual(payload.description.keyId, keys.find(1, "task_text"));
});

test("un texto vacío o solo espacios da BlobRef null y no crea blob", async () => {
  const result = await handler()(actor, input({ description: "", acceptanceCriteria: "  \n " }));
  assert.ok("number" in result);
  const payload = result.events[0]?.payload as Record<string, unknown>;
  assert.equal(payload.description, null);
  assert.equal(payload.acceptanceCriteria, null);
  // Solo el título (obligatorio) tiene clave y blob.
  assert.equal(count("data_keys"), 1);
  const root = paths(home).blobs;
  const files = readdirSync(root).flatMap((dir) => readdirSync(join(root, dir)));
  assert.equal(files.length, 1);
});

test("si el decider rechaza no se escribe ningún evento ni fila", async () => {
  const result = await handler({ decide: rejecting })(actor, input());
  assert.equal((result as DomainError).kind, "domain_error");
  assert.equal(count("events"), 0);
  assert.equal(count("tasks"), 0);
});

test("un número reservado nunca se reutiliza aunque el create falle después", async () => {
  await handler({ decide: rejecting })(actor, input());
  const failing: BlobStore = {
    put: async () => {
      throw new Error("disco lleno");
    },
    get: blobs.get.bind(blobs),
    shred: blobs.shred.bind(blobs),
  };
  await assert.rejects(handler({ blobs: failing })(actor, input()), /disco lleno/);
  assert.equal(count("events"), 0);
  const ok = await handler()(actor, input());
  assert.ok("number" in ok);
  assert.equal(ok.number, 3);
});

test("un VersionConflictError se propaga sin reintentar", async () => {
  await store.append("task:1", 0, [
    { type: "task.edited", schemaVersion: 1, actor, at: clock().toISOString(), payload: {} },
  ]);
  await assert.rejects(handler()(actor, input()), VersionConflictError);
  assert.equal(count("tasks"), 0);
});
