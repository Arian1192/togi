import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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

test("/v1/health incluye release, «dev» al ejecutarse desde el repo", async () => {
  const home = mkdtempSync(join(tmpdir(), "togi-health-release-"));
  const p = paths(home);
  const db = openEventDatabase(p.database);
  try {
    db.prepare("INSERT INTO users VALUES (?, ?, ?)").run("usr_1", "owner", "now");
    db.prepare("INSERT INTO tokens VALUES (?, ?, ?)").run(hashToken("tok"), "usr_1", "now");
    const keychain = selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } });
    const keys = new DataKeyring(db, await loadOrCreateMasterKey(keychain));
    const store = new SqliteEventStore(db);
    const blobs = new FileBlobStore(p.blobs, keys);
    const app = createApp(db, createHandler({ db, store, blobs }), {
      store,
      blobs,
      agentEvents: new AgentEventStore(db, blobs),
    });
    const res = await app.request("/v1/health", { headers: { authorization: "Bearer tok" } });
    const body = (await res.json()) as { release: unknown };
    assert.equal(body.release, "dev");
  } finally {
    db.close();
    rmSync(home, { recursive: true, force: true });
  }
});
