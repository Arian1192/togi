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
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-fields-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  db.prepare("INSERT INTO users VALUES ('usr_1', 'owner', 'now')").run();
  db.prepare("INSERT INTO tokens VALUES (?, 'usr_1', 'now')").run(hashToken("tok"));
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

const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method,
    headers: { authorization: "Bearer tok", "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const NEW = { title: "Filtro", risk: "low", repo: "o/r", baseBranch: "main" };

test("POST sin criterio: hasCriteria false; PATCH con criterio lo devuelve true", async () => {
  const post = (await (await send("POST", "/v1/tasks", NEW)).json()) as Record<string, unknown>;
  assert.equal(post.hasCriteria, false);
  assert.equal(post.repo, "o/r");
  assert.equal(post.baseBranch, "main");
  const res = await send(
    "PATCH",
    "/v1/tasks/1",
    { acceptanceCriteria: "algo" },
    { "if-match": "1" },
  );
  assert.equal(((await res.json()) as { hasCriteria: boolean }).hasCriteria, true);
});

test("la lista y el detalle exponen hasCriteria como booleano, nunca el texto, y las fechas", async () => {
  await send("POST", "/v1/tasks", { ...NEW, acceptanceCriteria: "secreto" });
  const list = (await (await send("GET", "/v1/tasks")).json()) as {
    tasks: Record<string, unknown>[];
  };
  assert.equal(list.tasks[0]?.hasCriteria, true);
  assert.ok(!JSON.stringify(list).includes("secreto"));
  const detail = (await (await send("GET", "/v1/tasks/1")).json()) as Record<string, unknown>;
  assert.equal(detail.baseBranch, "main");
  assert.equal(detail.createdAt, detail.updatedAt);
});
