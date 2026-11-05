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
import { AgentEventStore } from "../trajectory/agent-event-store.ts";
import { createApp } from "./app.ts";

let home: string;
let db: Database.Database;
let store: SqliteEventStore;
let app: ReturnType<typeof createApp>;
const TOKEN = "tok-de-prueba";
const NEW = {
  title: "Filtro",
  description: "descripción secreta",
  acceptanceCriteria: "criterio secreto",
  risk: "low",
  repo: "o/r",
};

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-ev-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  db.prepare("INSERT INTO users VALUES (?, ?, ?)").run("usr_1", "owner", "now");
  db.prepare("INSERT INTO tokens VALUES (?, ?, ?)").run(hashToken(TOKEN), "usr_1", "now");
  const keychain = selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } });
  const keys = new DataKeyring(db, await loadOrCreateMasterKey(keychain));
  store = new SqliteEventStore(db);
  const blobs = new FileBlobStore(p.blobs, keys);
  app = createApp(db, createHandler({ db, store, blobs }), {
    store,
    blobs,
    agentEvents: new AgentEventStore(db, blobs),
  });
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
const events = (n: number | string = 1) => send("GET", `/v1/tasks/${n}/events`);
const code = async (res: Response) => ((await res.json()) as { code: string }).code;

test("los eventos salen en orden de streamVersion y coinciden con los del stream", async () => {
  await send("POST", "/v1/tasks", NEW);
  await send("PATCH", "/v1/tasks/1", { title: "Otro" }, { "if-match": '"1"' });
  await send("POST", "/v1/tasks/1/submit", undefined, { "if-match": '"2"' });
  const res = await events();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { events: Record<string, unknown>[] };
  const stored = [];
  for await (const e of store.readStream("task:1")) stored.push(e);
  assert.deepEqual(
    body.events.map((e) => e.type),
    ["task.created", "task.edited", "task.submitted"],
  );
  assert.deepEqual(
    body.events.map((e) => e.streamVersion),
    [1, 2, 3],
  );
  assert.deepEqual(
    body.events.map((e) => [e.seq, e.stream, e.actor, e.at, e.payload]),
    stored.map((e) => [e.seq, e.stream, e.actor, e.at, e.payload]),
  );
});

test("la respuesta no contiene los textos en claro, tampoco el título", async () => {
  await send("POST", "/v1/tasks", NEW);
  await send(
    "POST",
    "/v1/tasks/1/reject",
    { reason: { category: "scope", text: "motivo secreto" } },
    {
      "if-match": '"1"',
    },
  );
  const text = await (await events()).text();
  for (const secret of ["descripción secreta", "criterio secreto", "motivo secreto"]) {
    assert.ok(!text.includes(secret), secret);
  }
  assert.ok(!text.includes('"title":"Filtro"'));
  assert.ok(text.includes("hmac-sha256:"));
});

test("una tarea inexistente y un número no válido dan 404 task_not_found", async () => {
  for (const n of ["99", "0", "x"]) {
    const res = await events(n);
    assert.equal(res.status, 404, n);
    assert.equal(await code(res), "task_not_found", n);
  }
});

test("sin token da 401", async () => {
  assert.equal((await app.request("/v1/tasks/1/events")).status, 401);
});

test("sin dependencias de lectura da 503 not_configured", async () => {
  const res = await createApp(db).request("/v1/tasks/1/events", {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(res.status, 503);
  assert.equal(await code(res), "not_configured");
});

test("un evento corrupto da integrity_error con su seq y ninguna lista parcial", async () => {
  await send("POST", "/v1/tasks", NEW);
  await send("PATCH", "/v1/tasks/1", { title: "Otro" }, { "if-match": '"1"' });
  db.exec("DROP TRIGGER events_no_update");
  db.prepare("UPDATE events SET payload = ? WHERE stream = 'task:1' AND stream_version = 2").run(
    '{"titulo":1}',
  );
  const seq = (
    db.prepare("SELECT seq FROM events WHERE stream = 'task:1' AND stream_version = 2").get() as {
      seq: number;
    }
  ).seq;
  const res = await events();
  assert.equal(res.status, 500);
  assert.equal(res.headers.get("content-type"), "application/problem+json");
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.code, "integrity_error");
  assert.equal(body.seq, seq);
  assert.equal(body.events, undefined);
});
