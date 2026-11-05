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
let app: ReturnType<typeof createApp>;
const TOKEN = "tok-de-prueba";

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-di-"));
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

test("el detalle con un evento corrupto da integrity_error con su seq", async () => {
  await app.request("/v1/tasks", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ title: "Filtro", risk: "low", repo: "o/r" }),
  });
  db.exec("DROP TRIGGER events_no_update");
  db.prepare("UPDATE events SET payload = '{}' WHERE stream = 'task:1'").run();
  const res = await app.request("/v1/tasks/1", { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(res.status, 500);
  assert.equal(res.headers.get("content-type"), "application/problem+json");
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.code, "integrity_error");
  assert.equal(body.seq, 1);
});
