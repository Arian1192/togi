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

const TOKEN = "tok-de-prueba";
const AUTH = { authorization: `Bearer ${TOKEN}` };
let home: string;
let db: Database.Database;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-health-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  db.prepare("INSERT INTO users VALUES (?, ?, ?)").run("usr_1", "owner", "now");
  db.prepare("INSERT INTO tokens VALUES (?, ?, ?)").run(hashToken(TOKEN), "usr_1", "now");
  const keychain = selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } });
  const keys = new DataKeyring(db, await loadOrCreateMasterKey(keychain));
  const store = new SqliteEventStore(db);
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

const lastSeq = async (): Promise<unknown> =>
  ((await (await app.request("/v1/health", { headers: AUTH })).json()) as { lastSeq: unknown })
    .lastSeq;

test("health devuelve lastSeq 0 con el log vacío", async () => {
  assert.equal(await lastSeq(), 0);
});

test("health devuelve el seq del último evento y avanza con cada escritura", async () => {
  const create = () =>
    app.request("/v1/tasks", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ title: "Filtro", risk: "low", repo: "o/r" }),
    });
  assert.equal((await create()).status, 201);
  assert.equal(await lastSeq(), 1);
  assert.equal((await create()).status, 201);
  assert.equal(await lastSeq(), 2);
});
