import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { Actor } from "@togi/core";
import type Database from "better-sqlite3";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { createHandler } from "../commands/handle-command.ts";
import { paths } from "../config/app.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import type { Notification } from "../notify/notifier.ts";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { FakePlanner } from "../testing/fake-planner.ts";
import { createOrchestrator } from "./orchestrator.ts";
import type { Planner, PlanOutcome } from "./planner.ts";

const KEY = ["sk", "ant", "api03", "D".repeat(40)].join("-");
const TITLE = 'Filtro"; do shell script "touch /tmp/x"';
const human: Actor = { kind: "human", userId: "usr_1" };
const usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, durationMs: 0 };

let home: string;
let db: Database.Database;
let store: SqliteEventStore;
let handle: ReturnType<typeof createHandler>;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-orq-notify-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  store = new SqliteEventStore(db);
  const keys = new DataKeyring(
    db,
    await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } })),
  );
  handle = createHandler({ db, store, blobs: new FileBlobStore(p.blobs, keys) });
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

async function submit(): Promise<number> {
  const made = await handle(human, {
    type: "create",
    title: TITLE,
    description: "d",
    acceptanceCriteria: "c",
    risk: "low",
    repo: "acme/app",
    baseBranch: "main",
    source: { kind: "cli" },
  });
  assert.ok("number" in made);
  await handle(human, { type: "submit", number: made.number });
  return made.number;
}

/** Planifica una tarea con título hostil y devuelve lo que se notificó; el título nunca aparece. */
async function notified(
  planner: Planner,
  { registered = true, notify, wrap = (h) => h } = {} as {
    registered?: boolean;
    notify?: (n: Notification) => void;
    wrap?: (h: typeof handle) => typeof handle;
  },
) {
  if (registered) {
    db.prepare("INSERT INTO repos (repo, path, added_at) VALUES ('acme/app', '/clon', 'x')").run();
  }
  const sent: Notification[] = [];
  const log = mock.method(console, "error", () => {});
  try {
    const orchestrator = createOrchestrator({
      db,
      store,
      handle: wrap(handle),
      planner,
      notify: (n) => {
        sent.push(n);
        notify?.(n);
      },
    });
    orchestrator.start();
    const number = await submit();
    await orchestrator.idle();
    await orchestrator.close();
    const all = JSON.stringify(sent);
    assert.ok(!all.includes("Filtro") && !all.includes("shell"), all);
    return { number, sent, lines: log.mock.calls.map((c) => String(c.arguments[0])) };
  } finally {
    log.mock.restore();
  }
}
const failing = (outcome: PlanOutcome): Planner => ({
  identity: new FakePlanner().identity,
  plan: async () => outcome,
});

test("un plan propuesto notifica el número y el comando para verlo", async () => {
  const { number, sent } = await notified(new FakePlanner());
  assert.deepEqual(sent, [
    { title: "togi: plan listo", message: `#${number} · togi plan show ${number}` },
  ]);
});

test("una sesión fallida notifica número, código y comando, nunca el texto del agente", async () => {
  const { number, sent } = await notified(
    failing({ ok: false, code: "agent_failed", reason: `agente: ${KEY} ${TITLE}`, usage }),
  );
  assert.deepEqual(sent, [
    {
      title: "togi: sesión fallida",
      message: `#${number} · agent_failed · togi plan retry ${number}`,
    },
  ]);
});

test("un repo sin registrar notifica con su comando, sin el nombre del repo", async () => {
  const { number, sent } = await notified(new FakePlanner(), { registered: false });
  assert.deepEqual(sent, [
    {
      title: "togi: sesión fallida",
      message: `#${number} · repo_not_registered · togi repo add`,
    },
  ]);
  assert.ok(!JSON.stringify(sent).includes("acme"));
});

test("un fallo antes de abrir sesión notifica el fallo del orquestador", async () => {
  const { number, sent } = await notified({
    identity: () => {
      throw new Error("sin identidad");
    },
    plan: async () => ({ ok: false, reason: "no debería llamarse", usage }),
  });
  assert.deepEqual(sent, [
    { title: "togi: falló el orquestador", message: `#${number} · togi plan retry ${number}` },
  ]);
});

test("si la planificación ni empieza (drain) notifica el fallo del orquestador", async () => {
  const { number, sent } = await notified(new FakePlanner(), {
    wrap: (h) =>
      ((actor, command) => {
        if (command.type === "startSession") throw new Error("disco lleno");
        return h(actor, command);
      }) as typeof handle,
  });
  assert.deepEqual(sent, [
    { title: "togi: falló el orquestador", message: `#${number} · togi plan retry ${number}` },
  ]);
});

test("recuperar una sesión abierta tras un reinicio no notifica", async () => {
  db.prepare("INSERT INTO repos (repo, path, added_at) VALUES ('acme/app', '/clon', 'x')").run();
  const number = await submit();
  const started = await handle(
    { kind: "system", component: "adapter:planner" },
    {
      type: "startSession",
      number,
      session: {
        ...new FakePlanner().identity,
        sessionId: "ses_abierta",
        role: "planner",
        cycle: null,
        workspaceId: null,
      },
    },
  );
  assert.ok("events" in started);
  const sent: Notification[] = [];
  const orchestrator = createOrchestrator({ db, store, handle, notify: (n) => sent.push(n) });
  await orchestrator.recover();
  const state = db.prepare("SELECT failure_reason AS r FROM sessions").get() as { r: string };
  assert.equal(state.r, "daemon_restarted");
  assert.deepEqual(sent, []);
});

test("un notificador que lanza no rompe la planificación", async () => {
  const { number, sent, lines } = await notified(new FakePlanner(), {
    notify: () => {
      throw new Error(`roto ${KEY}`);
    },
  });
  assert.equal(sent.length, 1);
  const row = db.prepare("SELECT state, failure_reason AS r FROM sessions").get() as {
    state: string;
    r: string | null;
  };
  assert.deepEqual(row, { state: "ended", r: null });
  const plan = db.prepare("SELECT 1 FROM plans WHERE task_number = ?").get(number);
  assert.ok(plan);
  assert.ok(lines.some((l) => l.startsWith("orquestador: no se pudo notificar")));
  assert.ok(!lines.join("\n").includes(KEY));
});
