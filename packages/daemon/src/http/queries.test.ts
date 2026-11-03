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
const TOKEN = "tok-de-prueba";
const NEW = { title: "Filtro", acceptanceCriteria: "criterio", risk: "low", repo: "o/r" };

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-q-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  db.prepare("INSERT INTO users VALUES (?, ?, ?)").run("usr_1", "owner", "now");
  db.prepare("INSERT INTO tokens VALUES (?, ?, ?)").run(hashToken(TOKEN), "usr_1", "now");
  const keychain = selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } });
  const keys = new DataKeyring(db, await loadOrCreateMasterKey(keychain));
  const store = new SqliteEventStore(db);
  app = createApp(db, createHandler({ db, store, blobs: new FileBlobStore(p.blobs, keys) }));
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const numbers = async (path: string) =>
  ((await (await send("GET", path)).json()) as { tasks: { number: number }[] }).tasks.map(
    (t) => t.number,
  );
const seed = async () => {
  for (let i = 0; i < 3; i++) await send("POST", "/v1/tasks", NEW);
  await send("POST", "/v1/tasks/2/submit", undefined, { "if-match": "1" });
};

test("GET /v1/tasks lista todas las tareas por número", async () => {
  await seed();
  assert.deepEqual(await numbers("/v1/tasks"), [1, 2, 3]);
});

test("GET /v1/tasks devuelve número, título, estado, riesgo y versión", async () => {
  await seed();
  const body = (await (await send("GET", "/v1/tasks?state=planning")).json()) as {
    tasks: unknown[];
  };
  assert.deepEqual(body.tasks, [
    { number: 2, title: "Filtro", state: "planning", risk: "low", version: 2 },
  ]);
});

test("GET /v1/tasks?state= filtra por estado", async () => {
  await seed();
  assert.deepEqual(await numbers("/v1/tasks?state=draft"), [1, 3]);
  assert.deepEqual(await numbers("/v1/tasks?state=merged"), []);
});

test("GET /v1/tasks?limit= respeta el límite", async () => {
  await seed();
  assert.deepEqual(await numbers("/v1/tasks?limit=2"), [1, 2]);
});

test("GET /v1/tasks acepta limit=1 y limit=200", async () => {
  assert.equal((await send("GET", "/v1/tasks?limit=1")).status, 200);
  assert.equal((await send("GET", "/v1/tasks?limit=200")).status, 200);
});

for (const query of ["state=nope", "limit=0", "limit=201", "limit=abc", "limit=", "limit=-1"]) {
  test(`GET /v1/tasks?${query}: 400 validation_error`, async () => {
    const res = await send("GET", `/v1/tasks?${query}`);
    assert.equal(res.status, 400);
    assert.equal(res.headers.get("content-type"), "application/problem+json");
    assert.equal(((await res.json()) as { code: string }).code, "validation_error");
  });
}

test("GET /v1/tasks sin token: 401", async () => {
  assert.equal((await app.request("/v1/tasks")).status, 401);
});
