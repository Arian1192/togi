import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type Database from "better-sqlite3";
import { hc } from "hono/client";
import { hashToken } from "../auth/tokens.ts";
import { erase } from "../blobs/erase.ts";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { createHandler } from "../commands/handle-command.ts";
import { paths } from "../config/app.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { type AppType, createApp } from "./app.ts";

let home: string;
let db: Database.Database;
let app: ReturnType<typeof createApp>;
let deps: Parameters<typeof erase>[0];
const TOKEN = "tok-de-prueba";
const NEW = {
  title: "Filtro",
  description: "descripción secreta",
  acceptanceCriteria: "criterio secreto",
  risk: "low",
  repo: "o/r",
};

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-d-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  db.prepare("INSERT INTO users VALUES (?, ?, ?)").run("usr_1", "owner", "now");
  db.prepare("INSERT INTO tokens VALUES (?, ?, ?)").run(hashToken(TOKEN), "usr_1", "now");
  const keychain = selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } });
  const keys = new DataKeyring(db, await loadOrCreateMasterKey(keychain));
  const store = new SqliteEventStore(db);
  const blobs = new FileBlobStore(p.blobs, keys);
  deps = { events: store, keys, blobs };
  app = createApp(db, createHandler({ db, store, blobs }), { store, blobs });
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
const detail = (n: number | string = 1) => send("GET", `/v1/tasks/${n}`);
const code = async (res: Response) => ((await res.json()) as { code: string }).code;
const eachBlob = (fn: (path: string) => void) => {
  const root = paths(home).blobs;
  for (const dir of readdirSync(root)) {
    for (const file of readdirSync(join(root, dir))) fn(join(root, dir, file));
  }
};

test("el detalle devuelve los textos descifrados", async () => {
  await send("POST", "/v1/tasks", NEW);
  const res = await detail();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    number: 1,
    title: "Filtro",
    state: "draft",
    risk: "low",
    version: 1,
    description: "descripción secreta",
    acceptanceCriteria: "criterio secreto",
    erased: { description: false, acceptanceCriteria: false },
  });
});

test("el detalle lleva el ETag con la versión de la tarea", async () => {
  await send("POST", "/v1/tasks", NEW);
  assert.equal((await detail()).headers.get("etag"), '"1"');
  await send("PATCH", "/v1/tasks/1", { title: "Otro" }, { "if-match": '"1"' });
  const res = await detail();
  assert.equal(res.headers.get("etag"), '"2"');
  assert.equal(((await res.json()) as { title: string }).title, "Otro");
});

test("un texto vacío es null y no está marcado como borrado", async () => {
  await send("POST", "/v1/tasks", { ...NEW, description: "" });
  const body = (await (await detail()).json()) as Record<string, unknown>;
  assert.equal(body.description, null);
  assert.deepEqual(body.erased, { description: false, acceptanceCriteria: false });
});

test("tras erase de task_text: 200 y textos null marcados como borrados", async () => {
  await send("POST", "/v1/tasks", NEW);
  await erase(deps, 1, "task_text", "RGPD", { kind: "human", userId: "usr_1" });
  const res = await detail();
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.description, null);
  assert.equal(body.acceptanceCriteria, null);
  assert.deepEqual(body.erased, { description: true, acceptanceCriteria: true });
  assert.equal(body.title, "[borrado]");
});

test("un blob alterado en disco con su clave intacta es error de integridad, no un borrado", async () => {
  await send("POST", "/v1/tasks", NEW);
  eachBlob((path) => {
    const bytes = readFileSync(path);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
    writeFileSync(path, bytes);
  });
  const res = await detail();
  assert.equal(res.status, 500);
  assert.equal(res.headers.get("content-type"), "application/problem+json");
  assert.equal(await code(res), "integrity_error");
});

test("un blob ausente con su clave presente es error de integridad, no un borrado", async () => {
  await send("POST", "/v1/tasks", NEW);
  eachBlob((path) => rmSync(path));
  const res = await detail();
  assert.equal(res.status, 500);
  assert.equal(await code(res), "integrity_error");
});

test("una tarea inexistente da 404 task_not_found", async () => {
  const res = await detail(99);
  assert.equal(res.status, 404);
  assert.equal(await code(res), "task_not_found");
});

test("un número no válido da 404 task_not_found", async () => {
  for (const n of ["0", "x"]) assert.equal((await detail(n)).status, 404, n);
});

test("el detalle sin token da 401", async () => {
  assert.equal((await app.request("/v1/tasks/1")).status, 401);
});

test("sin dependencias de lectura, el detalle da 503 not_configured", async () => {
  const res = await createApp(db).request("/v1/tasks/1", {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(res.status, 503);
  assert.equal(await code(res), "not_configured");
});

test("hc<AppType> tipa GET /v1/tasks/:n", () => {
  const client = hc<AppType>("http://localhost");
  void (() => client.v1.tasks[":n"].$get({ param: { n: "1" } }));
});

test("la lista da [borrado] tras erase de task_text y 500 integrity_error si el blob está alterado", async () => {
  await send("POST", "/v1/tasks", NEW);
  await send("POST", "/v1/tasks", NEW);
  await erase(deps, 2, "task_text", "RGPD", { kind: "human", userId: "usr_1" });
  const titles = ((await (await send("GET", "/v1/tasks")).json()) as { tasks: { title: string }[] })
    .tasks;
  assert.deepEqual(
    titles.map((t) => t.title),
    ["Filtro", "[borrado]"],
  );
  rmSync(paths(home).blobs, { recursive: true });
  const res = await send("GET", "/v1/tasks");
  assert.equal(res.status, 500);
  assert.equal(await code(res), "integrity_error");
});
