import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { Actor, SessionOrder } from "@togi/core";
import type Database from "better-sqlite3";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { RedactingBlobStore } from "../blobs/redacting-blob-store.ts";
import { createHandler } from "../commands/handle-command.ts";
import { paths } from "../config/app.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { AgentEventStore } from "../trajectory/agent-event-store.ts";
import { createWorkerLauncher } from "./worker-launcher.ts";

// Construido por partes: ningún detector de secretos lo ve como una clave en el código fuente.
const SECRET = ["sk", "ant", "valor", "real", "de", "prueba"].join("-");
const ENTRY = join(import.meta.dirname, "testing", "fake-worker.ts");
const system: Actor = { kind: "system", component: "adapter:planner" };

let home: string;
let db: Database.Database;
let blobs: RedactingBlobStore;
let agentEvents: AgentEventStore;
let launcher: ReturnType<typeof createWorkerLauncher>;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-launch-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  const key = await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } }));
  blobs = new RedactingBlobStore(new FileBlobStore(p.blobs, new DataKeyring(db, key)));
  agentEvents = new AgentEventStore(db, blobs);
  launcher = createWorkerLauncher({ agentEvents, workerEntry: ENTRY, graceMs: 300 });
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

const order = (mode: string, timeoutMs = 10_000, input?: string): SessionOrder => ({
  type: "session",
  sessionId: "ses_1",
  spec: {
    readPaths: [],
    writeDir: home,
    allowedDomains: [],
    allowedEnv: [],
    credentials: [],
    timeoutMs,
  },
  workspacesRoot: home,
  runtimePaths: [],
  argv: [mode],
  ...(input === undefined ? {} : { input }),
  credential: { name: "K", secret: SECRET },
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** No queda vivo ni el trabajador ni su hijo. */
async function assertNoSurvivors(file: string) {
  const { worker, child } = JSON.parse(readFileSync(file, "utf8")) as Record<string, number>;
  for (let i = 0; i < 40 && (alive(worker as number) || alive(child as number)); i++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(alive(worker as number), false, "el trabajador sigue vivo");
  assert.equal(alive(child as number), false, "el hijo del trabajador sigue vivo");
}

test("una sesión completa escribe cada evento en orden y cuenta los reales", async () => {
  const r = await launcher.run(order("complete"), 1);
  assert.equal(r.outcome, "completed");
  assert.equal(r.trajectoryEvents, 3);
  assert.deepEqual(
    agentEvents.readSession("ses_1").map((e) => e.seq),
    [1, 2, 3],
  );
});

test("tras la sesión, verify-log cruza session.ended con la trayectoria", async () => {
  const handle = createHandler({ db, store: new SqliteEventStore(db), blobs });
  const human: Actor = { kind: "human", userId: "usr_1" };
  const ok = (x: unknown) =>
    assert.ok(x && typeof x === "object" && "events" in x, JSON.stringify(x));
  ok(
    await handle(human, {
      type: "create",
      title: "t",
      description: "d",
      acceptanceCriteria: "c",
      risk: "low",
      repo: "r",
      baseBranch: "main",
      source: { kind: "cli" },
    }),
  );
  ok(await handle(human, { type: "submit", number: 1 }));
  ok(
    await handle(system, {
      type: "startSession",
      number: 1,
      session: {
        sessionId: "ses_1",
        role: "planner",
        cycle: null,
        runtime: { id: "fake", version: "1" },
        model: "m",
        specialist: { id: "generic-planner", version: 1, hash: "sha256:abc" },
        workspaceId: null,
        prompt: "p",
        policy: "q",
      },
    }),
  );
  const r = await launcher.run(order("complete"), 1);
  const usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, durationMs: r.durationMs };
  ok(
    await handle(system, {
      type: "endSession",
      number: 1,
      session: {
        sessionId: "ses_1",
        outcome: r.outcome,
        usage,
        trajectoryEvents: r.trajectoryEvents,
      },
    }),
  );
  assert.equal(r.trajectoryEvents, 3);
  assert.deepEqual(agentEvents.verify(), { ok: true });
});

test("el trabajador solo hereda la lista blanca: sin token, sin TOGI_HOME, sin credencial", async () => {
  Object.assign(process.env, { TOGI_HOME: home, TOGI_TOKEN: "token-del-daemon", K: SECRET });
  try {
    await launcher.run(order("env"), 1);
  } finally {
    delete process.env.TOGI_HOME;
    delete process.env.TOGI_TOKEN;
    delete process.env.K;
  }
  const [stored] = agentEvents.readSession("ses_1");
  const ref = JSON.parse((stored as { payload: string }).payload);
  const keys = JSON.parse(new TextDecoder().decode(await blobs.get(ref))) as string[];
  assert.ok(keys.includes("PATH"));
  // Las que añade el propio sistema o el shell al arrancar un proceso no vienen del daemon.
  const os = ["PATH", "PWD", "SHLVL", "_", "__CF_USER_TEXT_ENCODING"];
  for (const k of keys) assert.ok(os.includes(k), `variable heredada: ${k}`);
});

test("tope de tiempo agotado: la sesión es timeout y no queda nada vivo", async () => {
  const file = join(home, "pids.json");
  const r = await launcher.run(order("hang", 300, file), 1);
  assert.equal(r.outcome, "timeout");
  assert.equal(r.trajectoryEvents, 1);
  await assertNoSurvivors(file);
});

test("un trabajador que muere deja la sesión en failed, con lo escrito hasta entonces", async () => {
  const file = join(home, "pids.json");
  const r = await launcher.run(order("die", 10_000, file), 1);
  assert.equal(r.outcome, "failed");
  assert.equal(r.trajectoryEvents, 2);
  await assertNoSurvivors(file);
});

test("la cancelación cierra la sesión como cancelled y no queda nada vivo", async () => {
  const file = join(home, "pids.json");
  const abort = new AbortController();
  setTimeout(() => abort.abort(), 500);
  const r = await launcher.run(order("wait", 10_000, file), 1, abort.signal);
  assert.equal(r.outcome, "cancelled");
  await assertNoSurvivors(file);
});

test("un trabajador que ignora la cancelación se mata con SIGKILL al acabar la gracia", async () => {
  const file = join(home, "pids.json");
  const abort = new AbortController();
  setTimeout(() => abort.abort(), 300);
  const r = await launcher.run(order("hang", 10_000, file), 1, abort.signal);
  assert.equal(r.outcome, "cancelled");
  await assertNoSurvivors(file);
});

test("diagnostics guarda solo las últimas líneas de stderr y sin la credencial", async () => {
  const r = await launcher.run(order("stderr"), 1);
  const lines = r.diagnostics.split("\n");
  assert.equal(lines.length, 20);
  assert.equal(lines.at(-1), "linea 29");
  assert.ok(!r.diagnostics.includes(SECRET));
  // La primera línea (la credencial) ya salió de la cola; se comprueba también con una cola corta.
  const short = await createWorkerLauncher({ agentEvents, workerEntry: ENTRY }).run(
    { ...order("stderr"), sessionId: "ses_2" },
    1,
  );
  assert.ok(!short.diagnostics.includes(SECRET));
});
