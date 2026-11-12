import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Actor, genericBuilder, type SessionOrder, type StoredEvent } from "@togi/core";
import type Database from "better-sqlite3";
import { PROMOS_PROFILE } from "../../../../core/src/testing/promos-profile.ts";
import { claudeAgentSdkDeclaration } from "../../../../worker/src/adapters/claude-agent-sdk/declaration.ts";
import { FileBlobStore } from "../../blobs/file-blob-store.ts";
import { createHandler } from "../../commands/handle-command.ts";
import { paths } from "../../config/app.ts";
import { DataKeyring } from "../../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../../keys/master-key.ts";
import { selectKeychain } from "../../keys/select-keychain.ts";
import { openEventDatabase } from "../../store/database.ts";
import { SqliteEventStore } from "../../store/event-store.ts";
import type { LaunchResult } from "../../worker/worker-launcher.ts";
import { createTaskWorkspaces } from "../../workspaces/task-workspace.ts";
import type { BuildSessionDeps, BuildSessionInput } from "../builder-session.ts";

const human: Actor = { kind: "human", userId: "usr_1" };
const system: Actor = { kind: "system", component: "adapter:planner" };
const usage = { inputTokens: 1, outputTokens: 2, estimatedCostUsd: 0.1, durationMs: 5 };
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();

/** Un launcher falso: escribe en el árbol del clon (si `write`) y devuelve lo que diga el guion. */
export function fakeLauncher(script: (Partial<LaunchResult> & { write?: boolean })[] = []) {
  const orders: SessionOrder[] = [];
  const run = async (order: SessionOrder): Promise<LaunchResult> => {
    orders.push(order);
    const { write = true, ...result } = script.shift() ?? {};
    if (write) writeFileSync(join(order.spec.workTree ?? "", "b.txt"), `sesión ${orders.length}`);
    return {
      outcome: "completed",
      exitCode: 0,
      durationMs: 5,
      trajectoryEvents: 3,
      failureReason: null,
      usage,
      finalText: "hecho",
      diagnostics: "",
      ...result,
    };
  };
  return { orders, run };
}

/**
 * La tarea 1 de `acme/app` en `building`, con su plan aprobado sobre la punta de `main`, el store y
 * el handler reales, y el clon hecho con `prepareWorkspace`.
 */
export async function buildFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-build-session-")));
  const home = join(root, "home");
  const repo = join(root, "repo");
  mkdirSync(home);
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "remote", "add", "origin", "git@github.com:acme/app.git");
  writeFileSync(join(repo, "a.txt"), "uno");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "uno");
  const p = paths(home);
  const db: Database.Database = openEventDatabase(p.database);
  db.prepare("INSERT INTO repos (repo, path, added_at) VALUES (?, ?, ?)").run(
    "acme/app",
    repo,
    "x",
  );
  const keychain = selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } });
  const keys = new DataKeyring(db, await loadOrCreateMasterKey(keychain));
  const store = new SqliteEventStore(db);
  const handle = createHandler({ db, store, blobs: new FileBlobStore(p.blobs, keys) });
  await handle(human, {
    type: "create",
    title: "Arreglar el login",
    description: "",
    acceptanceCriteria: "criterio",
    risk: "low",
    repo: "acme/app",
    baseBranch: "main",
    source: { kind: "cli" },
  });
  await handle(human, { type: "submit", number: 1 });
  await handle(system, {
    type: "startSession",
    number: 1,
    session: {
      sessionId: "ses_p",
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
  await handle(
    { kind: "agent", sessionId: "ses_p", role: "planner" },
    {
      type: "proposePlan",
      number: 1,
      plan: {
        files: [{ path: "b.txt", change: "add" }],
        newTests: [],
        approach: "enfoque",
        estimatedLines: { production: 1, tests: 0 },
        baseSha: git(repo, "rev-parse", "main"),
      },
    },
  );
  await handle(system, {
    type: "endSession",
    number: 1,
    session: { sessionId: "ses_p", outcome: "completed", usage, trajectoryEvents: 0 },
  });
  assert.ok("events" in (await handle(human, { type: "approvePlan", number: 1, planVersion: 1 })));
  const ready = await createTaskWorkspaces({ db, store, handle, home }).prepareWorkspace(1);
  assert.ok(ready.ok);
  const { workspace, tree, gitDir } = ready;

  const input: BuildSessionInput = {
    number: 1,
    cycle: 1,
    workspace: { ...workspace, tree, gitDir },
    profile: PROMOS_PROFILE,
    planFiles: ["b.txt"],
    existingTests: [],
    prompt: "construye",
    specialist: genericBuilder,
    maxTurns: 30,
  };
  const deps = (
    launcher: BuildSessionDeps["launcher"],
    over: Partial<BuildSessionDeps> = {},
  ): BuildSessionDeps => ({
    handle,
    launcher,
    credentials: {
      read: async () => ({ mode: "api-key", envName: "ANTHROPIC_API_KEY", secret: "s" }),
    },
    declaration: claudeAgentSdkDeclaration,
    builderEntry: "/w/builder-main.ts",
    runtime: { id: "claude-agent-sdk", version: "1" },
    runtimePaths: ["/node"],
    executable: "/bin/claude",
    maxCostUsd: 2,
    timeoutMs: 60_000,
    ...over,
  });
  /** Los eventos de la tarea desde `workspace.created`: los que escribe la sesión de building. */
  const events = async () => {
    const all: StoredEvent[] = [];
    for await (const e of store.readStream("task:1")) all.push(e);
    return all.slice(all.findIndex((e) => e.type === "workspace.created") + 1);
  };
  const close = () => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  };
  return { db, handle, input, deps, events, close };
}

export type BuildFixture = Awaited<ReturnType<typeof buildFixture>>;
