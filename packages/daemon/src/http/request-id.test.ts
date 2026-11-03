import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type Database from "better-sqlite3";
import { hashToken } from "../auth/tokens.ts";
import { openEventDatabase } from "../store/database.ts";
import { createApp } from "./app.ts";

let dir: string;
let db: Database.Database;
const TOKEN = "tok-de-prueba";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "togi-rid-"));
  db = openEventDatabase(join(dir, "togi.db"));
  db.prepare("INSERT INTO users VALUES (?, ?, ?)").run("usr_1", "owner", "now");
  db.prepare("INSERT INTO tokens VALUES (?, ?, ?)").run(hashToken(TOKEN), "usr_1", "now");
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const auth = { authorization: `Bearer ${TOKEN}` };

test("el X-Request-Id recibido vuelve igual en la respuesta", async () => {
  const res = await createApp(db).request("/v1/health", {
    headers: { ...auth, "x-request-id": "req-abc" },
  });
  assert.equal(res.headers.get("x-request-id"), "req-abc");
});

test("sin X-Request-Id el daemon genera uno distinto en cada petición", async () => {
  const app = createApp(db);
  const a = (await app.request("/v1/health", { headers: auth })).headers.get("x-request-id");
  const b = (await app.request("/v1/health", { headers: auth })).headers.get("x-request-id");
  assert.ok(a && b && a !== b);
});

test("también el 401 lleva X-Request-Id", async () => {
  const res = await createApp(db).request("/v1/health", { headers: { "x-request-id": "r-1" } });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("x-request-id"), "r-1");
});

test("un X-Request-Id vacío, demasiado largo o con caracteres raros se sustituye", async () => {
  const app = createApp(db);
  for (const bad of ["", "x".repeat(129), "a bé"]) {
    const res = await app.request("/v1/health", { headers: { ...auth, "x-request-id": bad } });
    const id = res.headers.get("x-request-id");
    assert.ok(id && id !== bad && /^[\w.:-]{1,128}$/.test(id), JSON.stringify(bad));
  }
});
