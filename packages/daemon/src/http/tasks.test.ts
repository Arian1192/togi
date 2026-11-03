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
  home = mkdtempSync(join(tmpdir(), "togi-api-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  db.prepare("INSERT INTO users VALUES (?, ?, ?)").run("usr_1", "owner", "now");
  db.prepare("INSERT INTO tokens VALUES (?, ?, ?)").run(hashToken(TOKEN), "usr_1", "now");
  const masterKey = await loadOrCreateMasterKey(
    selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } }),
  );
  const blobs = new FileBlobStore(p.blobs, new DataKeyring(db, masterKey));
  app = createApp(db, createHandler({ db, store: new SqliteEventStore(db), blobs }));
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
const create = (body: unknown = NEW) => send("POST", "/v1/tasks", body);

test("POST /v1/tasks crea la tarea en draft: 201 con ETag", async () => {
  const res = await create();
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("etag"), '"1"');
  assert.deepEqual(await res.json(), {
    number: 1,
    title: "Filtro",
    state: "draft",
    risk: "low",
    repo: "o/r",
    baseBranch: "dev",
    hasCriteria: true,
    version: 1,
  });
});

test("el correlationId de los eventos es el X-Request-Id y el actor sale del token", async () => {
  await send("POST", "/v1/tasks", { ...NEW, actor: "otro" }, { "x-request-id": "req-1" });
  const row = db.prepare("SELECT * FROM events").get() as Record<string, string>;
  assert.equal(row.correlation_id, "req-1");
  assert.match(JSON.stringify(row), /usr_1/);
});

test("POST /v1/tasks con cuerpo inválido o no JSON: 400", async () => {
  for (const body of [{ ...NEW, title: "ab" }, {}]) {
    const res = await create(body);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "validation_error");
  }
  const raw = await app.request("/v1/tasks", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: "{no",
  });
  assert.equal(raw.status, 400);
  assert.equal((await raw.json()).code, "invalid_json");
});

test("PATCH edita con If-Match y devuelve la nueva versión", async () => {
  await create();
  const res = await send("PATCH", "/v1/tasks/1", { title: "Otro" }, { "if-match": '"1"' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("etag"), '"2"');
  assert.equal((await res.json()).title, "Otro");
});

test("sin If-Match: 428; con If-Match: *: 400; ilegible: 400", async () => {
  await create();
  assert.equal((await send("PATCH", "/v1/tasks/1", { title: "Otro" })).status, 428);
  for (const value of ["*", "abc", 'W/"1"', ""]) {
    const res = await send("PATCH", "/v1/tasks/1", { title: "Otro" }, { "if-match": value });
    assert.equal(res.status, 400, value);
    assert.equal((await res.json()).code, "invalid_if_match");
  }
  assert.equal((await send("GET", "/v1/health")).status, 200);
  assert.equal((db.prepare("SELECT stream_version v FROM tasks").get() as { v: number }).v, 1);
});

test("If-Match desactualizado: 412 con ETag actual y sin escribir", async () => {
  await create();
  const res = await send("PATCH", "/v1/tasks/1", { title: "Otro" }, { "if-match": "7" });
  assert.equal(res.status, 412);
  assert.equal(res.headers.get("etag"), '"1"');
  assert.equal((await res.json()).code, "precondition_failed");
});

test("tarea inexistente o número raro: 404 task_not_found", async () => {
  for (const n of ["99", "0", "x"]) {
    const res = await send("PATCH", `/v1/tasks/${n}`, { title: "Otro" }, { "if-match": "1" });
    assert.equal(res.status, 404, n);
    assert.equal((await res.json()).code, "task_not_found");
  }
});

test("las rutas de comandos exigen token", async () => {
  const res = await app.request("/v1/tasks", { method: "POST", body: "{}" });
  assert.equal(res.status, 401);
});

test("submit pasa a planning; reject pasa a rejected", async () => {
  await create();
  const submitted = await send("POST", "/v1/tasks/1/submit", undefined, { "if-match": "1" });
  assert.equal(submitted.status, 200);
  assert.equal((await submitted.json()).state, "planning");
  const rejected = await send(
    "POST",
    "/v1/tasks/1/reject",
    { reason: { category: "other", text: "no" } },
    { "if-match": "2" },
  );
  assert.equal(rejected.status, 200);
  assert.equal((await rejected.json()).state, "rejected");
});

test("submit sin If-Match: 428; con valor inválido: 400", async () => {
  await create();
  assert.equal((await send("POST", "/v1/tasks/1/submit")).status, 428);
  for (const value of ["*", "abc", 'W/"1"', ""]) {
    const res = await send("POST", "/v1/tasks/1/submit", undefined, { "if-match": value });
    assert.equal(res.status, 400, value);
    assert.equal((await res.json()).code, "invalid_if_match");
  }
});

test("submit sin criterios: 422; tarea inexistente o número raro: 404", async () => {
  await create({ ...NEW, acceptanceCriteria: "" });
  const submit = await send("POST", "/v1/tasks/1/submit", undefined, { "if-match": "1" });
  assert.equal(submit.status, 422);
  assert.equal((await submit.json()).code, "missing_acceptance_criteria");
  for (const n of ["99", "0", "x"]) {
    const res = await send("POST", `/v1/tasks/${n}/submit`, undefined, { "if-match": "1" });
    assert.equal(res.status, 404, n);
    assert.equal((await res.json()).code, "task_not_found");
  }
});

test("reject sin motivo válido: 400", async () => {
  await create();
  const res = await send(
    "POST",
    "/v1/tasks/1/reject",
    { reason: { category: "other", text: "" } },
    { "if-match": "1" },
  );
  assert.equal(res.status, 400);
});
