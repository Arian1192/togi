import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor } from "@togi/core";
import { hashToken } from "../../auth/tokens.ts";
import { FileBlobStore } from "../../blobs/file-blob-store.ts";
import { createHandler } from "../../commands/handle-command.ts";
import { paths } from "../../config/app.ts";
import { DataKeyring } from "../../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../../keys/master-key.ts";
import { selectKeychain } from "../../keys/select-keychain.ts";
import { openEventDatabase } from "../../store/database.ts";
import { SqliteEventStore } from "../../store/event-store.ts";
import { createApp } from "../app.ts";

export const TOKEN = "tok-de-prueba";
const human: Actor = { kind: "human", userId: "usr_1" };
const system: Actor = { kind: "system", component: "adapter:planner" };

/** Daemon de prueba con la tarea 1 enviada; `plan(n, production)` deja un plan propuesto. */
export async function planFixture() {
  const home = mkdtempSync(join(tmpdir(), "togi-plan-api-"));
  const p = paths(home);
  const db = openEventDatabase(p.database);
  db.prepare("INSERT INTO users VALUES (?, ?, ?)").run("usr_1", "owner", "now");
  db.prepare("INSERT INTO tokens VALUES (?, ?, ?)").run(hashToken(TOKEN), "usr_1", "now");
  const keys = new DataKeyring(
    db,
    await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } })),
  );
  const store = new SqliteEventStore(db);
  const blobs = new FileBlobStore(p.blobs, keys);
  const handle = createHandler({ db, store, blobs });
  const app = createApp(db, handle, { store, blobs });
  await handle(human, {
    type: "create",
    title: "Filtro",
    description: "",
    acceptanceCriteria: "criterio",
    risk: "low",
    repo: "o/r",
    baseBranch: "main",
    source: { kind: "cli" },
  });
  await handle(human, { type: "submit", number: 1 });
  let sessions = 0;
  return {
    db,
    app,
    handle,
    store,
    keys,
    blobs,
    close: () => {
      db.close();
      rmSync(home, { recursive: true, force: true });
    },
    /** Una sesión completa que propone un plan con ese enfoque y esas líneas de producción. */
    async plan(approach = "el enfoque", production = 10) {
      const sessionId = `ses_${++sessions}` as const;
      const agent: Actor = { kind: "agent", sessionId, role: "planner" };
      await handle(system, {
        type: "startSession",
        number: 1,
        session: {
          sessionId,
          role: "planner",
          cycle: null,
          runtime: { id: "fake", version: "1" },
          model: "m",
          specialist: { id: "generic-planner", version: 1, hash: "sha256:abc" },
          workspaceId: null,
          prompt: "prompt",
          policy: "política",
        },
      });
      await handle(agent, {
        type: "proposePlan",
        number: 1,
        plan: {
          files: [{ path: "src/a.ts", change: "modify" }],
          newTests: ["src/a.test.ts"],
          approach,
          estimatedLines: { production, tests: 20 },
          baseSha: "abc123",
        },
      });
      const usage = { inputTokens: 1, outputTokens: 2, estimatedCostUsd: 0.1, durationMs: 5 };
      await handle(system, {
        type: "endSession",
        number: 1,
        session: { sessionId, outcome: "completed", usage, trajectoryEvents: 0 },
      });
    },
    send: (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      app.request(path, {
        method,
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  };
}
