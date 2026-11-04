import type { Actor } from "@togi/core";
import { paths } from "@togi/daemon/config";
import { FileBlobStore } from "../../../daemon/src/blobs/file-blob-store.ts";
import { createHandler } from "../../../daemon/src/commands/handle-command.ts";
import { DataKeyring } from "../../../daemon/src/keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../../../daemon/src/keys/master-key.ts";
import { selectKeychain } from "../../../daemon/src/keys/select-keychain.ts";
import type { startDaemon } from "../../../daemon/src/start.ts";
import { SqliteEventStore } from "../../../daemon/src/store/event-store.ts";

const system: Actor = { kind: "system", component: "adapter:planner" };

export interface SeedOptions {
  approach?: string;
  production?: number;
  tests?: number;
}

/** Hace que un planificador falso proponga un plan sobre una tarea ya enviada, sin pasar por la CLI. */
export async function seedPlans(home: string, daemon: Awaited<ReturnType<typeof startDaemon>>) {
  const p = paths(home);
  const keys = new DataKeyring(
    daemon.db,
    await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } })),
  );
  const handle = createHandler({
    db: daemon.db,
    store: new SqliteEventStore(daemon.db),
    blobs: new FileBlobStore(p.blobs, keys),
  });
  let sessions = 0;
  const human: Actor = { kind: "human", userId: daemon.userId };
  const plan = async (number: number, options: SeedOptions = {}) => {
    const sessionId = `ses_${++sessions}` as const;
    const agent: Actor = { kind: "agent", sessionId, role: "planner" };
    await handle(system, {
      type: "startSession",
      number,
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
      number,
      plan: {
        files: [
          { path: "src/a.ts", change: "modify" },
          { path: "src/b.ts", change: "add" },
        ],
        newTests: ["src/a.test.ts"],
        approach: options.approach ?? "el enfoque",
        estimatedLines: { production: options.production ?? 10, tests: options.tests ?? 20 },
        baseSha: "abc123",
      },
    });
    const usage = { inputTokens: 1, outputTokens: 2, estimatedCostUsd: 0.1, durationMs: 5 };
    await handle(system, {
      type: "endSession",
      number,
      session: { sessionId, outcome: "completed", usage, trajectoryEvents: 0 },
    });
  };
  /** Pide cambios sobre el plan de la versión dada, como la persona. */
  const requestChanges = async (number: number, planVersion: number) => {
    await handle(human, {
      type: "requestPlanChanges",
      number,
      planVersion,
      category: "scope",
      text: "más pequeño",
    });
  };
  return { plan, requestChanges };
}
