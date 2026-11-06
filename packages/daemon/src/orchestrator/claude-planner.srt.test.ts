import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, mock, test } from "node:test";
import {
  type Actor,
  DEFAULT_FLOW,
  type SessionEnded,
  type SessionStarted,
  toDomainEvent,
} from "@togi/core";
import type Database from "better-sqlite3";
import { claudeAgentSdkDeclaration } from "../../../worker/src/adapters/claude-agent-sdk/declaration.ts";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { RedactingBlobStore } from "../blobs/redacting-blob-store.ts";
import { type CreateTaskInput, createHandler } from "../commands/handle-command.ts";
import { paths } from "../config/app.ts";
import { InconsistentCredentialsError } from "../credentials/agent-credential.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { AgentEventStore } from "../trajectory/agent-event-store.ts";
import { createWorkerLauncher } from "../worker/worker-launcher.ts";
import { ClaudePlanner } from "./claude-planner.ts";
import { createOrchestrator } from "./orchestrator.ts";
import { claudeRuntime } from "./runtime-paths.ts";

const SKIP = process.platform === "darwin" ? undefined : "SrtSandbox solo funciona en macOS";
// Por partes: ningún detector de secretos lo ve como una clave en el código fuente.
const SECRET = ["sk", "ant", "valor", "real", "de", "prueba"].join("-");
const WORKER = join(import.meta.dirname, "..", "..", "..", "worker");
const AGENT_DIR = join(import.meta.dirname, "testing");
const human: Actor = { kind: "human", userId: "usr_1" };

let root: string;
let home: string;
let db: Database.Database;
let store: SqliteEventStore;
let handle: ReturnType<typeof createHandler>;
let agentEvents: AgentEventStore;

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "togi-claude-planner-")));
  home = join(root, "home");
  mkdirSync(home);
  const p = paths(home);
  db = openEventDatabase(p.database);
  store = new SqliteEventStore(db);
  const key = await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } }));
  const blobs = new RedactingBlobStore(new FileBlobStore(p.blobs, new DataKeyring(db, key)), [
    SECRET,
  ]);
  handle = createHandler({ db, store, blobs });
  agentEvents = new AgentEventStore(db, blobs);

  const clone = join(root, "clone");
  mkdirSync(clone);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: clone });
  git("init", "-q", "-b", "main");
  git("remote", "add", "origin", "git@github.com:acme/app.git");
  writeFileSync(join(clone, "README.md"), "hola desde el repo");
  git("add", ".");
  git("commit", "-q", "-m", "uno");
  db.prepare("INSERT INTO repos (repo, path, added_at) VALUES ('acme/app', ?, 'x')").run(clone);
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const credentials = {
  status: async () => "api-key" as const,
  read: async () => ({ mode: "api-key" as const, envName: "ANTHROPIC_API_KEY", secret: SECRET }),
};

function planner(over: Partial<ConstructorParameters<typeof ClaudePlanner>[0]> = {}) {
  const runtime = claudeRuntime(WORKER);
  return new ClaudePlanner({
    db,
    store,
    readText: handle.readText,
    home,
    credentials,
    launcher: createWorkerLauncher({
      agentEvents,
      workerEntry: join(WORKER, "src", "main.ts"),
      graceMs: 500,
    }),
    declaration: claudeAgentSdkDeclaration,
    agentEntry: join(AGENT_DIR, "fake-agent.mjs"),
    runtime: { id: "claude-agent-sdk", version: runtime.sdkVersion },
    // El agente falso es un .mjs suelto: solo hace falta Node y su carpeta.
    runtimePaths: [dirname(realpathSync(process.execPath)), AGENT_DIR],
    maxCostUsd: 1,
    ...over,
  });
}

const task = (title: string): CreateTaskInput => ({
  type: "create",
  title,
  description: "descripción",
  acceptanceCriteria: "criterio",
  risk: "low",
  repo: "acme/app",
  baseBranch: "main",
  source: { kind: "cli" },
});

/** Crea y envía una tarea, deja que el orquestador la planifique y devuelve lo que quedó en el log. */
async function planWith(title: string, over: Parameters<typeof planner>[0] = {}) {
  const orchestrator = createOrchestrator({
    db,
    store,
    handle,
    planner: planner(over),
    flow: DEFAULT_FLOW,
  });
  orchestrator.start();
  const made = await handle(human, task(title));
  assert.ok("number" in made);
  await handle(human, { type: "submit", number: made.number });
  await orchestrator.idle();
  await orchestrator.close();
  const events: { type: string; payload: unknown }[] = [];
  for await (const e of store.readStream(`task:${made.number}`)) events.push(toDomainEvent(e));
  const one = <T>(type: string) => events.find((e) => e.type === type)?.payload as T;
  return {
    number: made.number,
    state: (
      db.prepare("SELECT state FROM tasks WHERE number = ?").get(made.number) as { state: string }
    ).state,
    started: one<SessionStarted>("session.started"),
    ended: one<SessionEnded>("session.ended"),
    approach: db.prepare("SELECT approach FROM plans WHERE task_number = ?").get(made.number) as
      | { approach: string }
      | undefined,
  };
}

/** Nada de la copia ni del directorio desechable debe quedar. */
const leftovers = () =>
  existsSync(join(home, "workspaces")) ? readdirSync(join(home, "workspaces")) : [];

test("ciclo completo con sandbox real: el agente lee la copia, ve un marcador y el plan queda en plan_review", {
  skip: SKIP,
}, async () => {
  const r = await planWith("MODE:ok");
  assert.equal(r.state, "plan_review");
  assert.deepEqual([r.ended.outcome, r.ended.failureReason], ["completed", null]);
  assert.equal(r.ended.trajectoryEvents, 3);
  assert.equal(r.ended.usage.estimatedCostUsd, 0.1);
  const plan = db.prepare("SELECT approach, base_sha FROM plans").get() as {
    approach: string;
    base_sha: string;
  };
  const approach = await handle.readText(JSON.parse(plan.approach));
  assert.match(approach, /readme=hola desde el repo/);
  assert.ok(!approach.includes(SECRET), "el agente no debe ver la credencial real");
  assert.match(approach, /key=\S+/); // sí un marcador
  assert.match(plan.base_sha, /^[0-9a-f]{40}$/);
  assert.match(approach, /budget=1/);
  assert.deepEqual(leftovers(), []);
});

test("el prompt registrado en session.started es el que recibe el agente", {
  skip: SKIP,
}, async () => {
  const r = await planWith("MODE:ok");
  assert.equal(r.started.runtime.id, "claude-agent-sdk");
  assert.equal(r.started.runtime.version, claudeRuntime(WORKER).sdkVersion);
  const plan = db.prepare("SELECT approach FROM plans").get() as { approach: string };
  const approach = await handle.readText(JSON.parse(plan.approach));
  const registered = await handle.readText(r.started.prompt);
  assert.match(registered, /MODE:ok/);
  assert.ok(approach.includes(`prompt=${createHash("sha256").update(registered).digest("hex")}`));
  const policy = JSON.parse(await handle.readText(r.started.policy));
  assert.deepEqual(
    [policy.credentialMode, policy.maxCostUsd, policy.timeoutMs, policy.tools],
    ["api-key", 1, 600_000, ["Read", "Glob", "Grep"]],
  );
});

test("una respuesta inválida se reintenta una vez con el error y se suma el uso", {
  skip: SKIP,
}, async () => {
  const r = await planWith("MODE:bad-then-good");
  assert.equal(r.state, "plan_review");
  assert.equal(r.ended.usage.estimatedCostUsd, 0.2);
  assert.equal(r.ended.trajectoryEvents, 6);
  assert.deepEqual(leftovers(), []);
});

test("si el reintento también es inválido, la sesión acaba con invalid_plan", {
  skip: SKIP,
}, async () => {
  const r = await planWith("MODE:always-bad");
  assert.equal(r.state, "planning");
  assert.deepEqual([r.ended.outcome, r.ended.failureReason], ["failed", "invalid_plan"]);
  assert.deepEqual(leftovers(), []);
});

test("el tope de coste del agente llega como budget_exceeded", { skip: SKIP }, async () => {
  const r = await planWith("MODE:budget");
  assert.deepEqual([r.ended.outcome, r.ended.failureReason], ["failed", "budget_exceeded"]);
  assert.equal(r.ended.usage.estimatedCostUsd, 0.9);
  assert.deepEqual(leftovers(), []);
});

test("el tope de tiempo mata al agente: timeout, y no queda nada", { skip: SKIP }, async () => {
  const r = await planWith("MODE:hang", { timeoutMs: 2500 });
  assert.deepEqual([r.ended.outcome, r.ended.failureReason], ["failed", "timeout"]);
  assert.deepEqual(leftovers(), []);
});

test("si el sandbox no puede arrancar, la sesión acaba con sandbox_unavailable y el agente no se lanza", async () => {
  const r = await planWith("MODE:ok", {
    runtimePaths: [join(root, "no-existe")],
  });
  assert.equal(r.state, "planning");
  assert.deepEqual([r.ended.outcome, r.ended.failureReason], ["failed", "sandbox_unavailable"]);
  assert.equal(r.ended.trajectoryEvents, 0);
  assert.deepEqual(leftovers(), []);
});

test("un fallo del agente deja en daemon.log el código y su stderr, sin secretos", {
  skip: SKIP,
}, async () => {
  const log = mock.method(console, "error", () => {});
  try {
    const r = await planWith("MODE:stderr");
    assert.deepEqual([r.ended.outcome, r.ended.failureReason], ["failed", "agent_failed"]);
    const lines = log.mock.calls.map((c) => String(c.arguments[0])).join("\n");
    assert.match(lines, /el planificador falló en la tarea \d+ \(agent_failed\)/);
    assert.match(
      lines,
      /agente: Error: la API rechazó la petición con \[REDACTED:anthropic-api-key\]/,
    );
    assert.match(lines, /agente: segunda línea de contexto/);
    assert.ok(!lines.includes("A".repeat(40)), "la clave no debe llegar al log");
  } finally {
    log.mock.restore();
  }
  assert.deepEqual(leftovers(), []);
});

test("los escapes de terminal y los saltos de línea del stderr del agente no llegan al log", {
  skip: SKIP,
}, async () => {
  const log = mock.method(console, "error", () => {});
  try {
    await planWith("MODE:escape");
    const entry = log.mock.calls
      .map((c) => String(c.arguments[0]))
      .find((l) => l.includes("el planificador falló"));
    assert.ok(entry, "falta la entrada del fallo");
    assert.ok(!/\p{Cc}/u.test(entry), "ni escapes ni saltos de línea sin escapar");
    assert.match(entry, /agente: \]0;titulo\[31mroja\[0m2Jtexto/);
    // La línea falsa queda dentro de la entrada, no como una línea del orquestador.
    assert.ok(entry.includes("agente: orquestador: FALSO plan aprobado"));
    assert.ok(!entry.split("\n").some((l) => l.startsWith("orquestador: FALSO")));
  } finally {
    log.mock.restore();
  }
  assert.deepEqual(leftovers(), []);
});

test("sin credencial, la sesión se abre y se cierra con credential_missing antes de lanzar nada", async () => {
  const r = await planWith("MODE:ok", {
    credentials: { status: async () => null, read: async () => null },
  });
  assert.equal(r.state, "planning");
  assert.deepEqual([r.ended.outcome, r.ended.failureReason], ["failed", "credential_missing"]);
  assert.equal(r.ended.trajectoryEvents, 0);
  assert.deepEqual(leftovers(), []);
});

test("con las credenciales de los dos modos (inconsistent) también es credential_missing", async () => {
  const r = await planWith("MODE:ok", {
    credentials: {
      status: async () => "inconsistent" as const,
      read: async () => {
        throw new InconsistentCredentialsError();
      },
    },
  });
  assert.deepEqual([r.ended.outcome, r.ended.failureReason], ["failed", "credential_missing"]);
  assert.equal(r.ended.trajectoryEvents, 0);
  assert.deepEqual(leftovers(), []);
});

test("un repo que ya no existe cierra la sesión sin dejar copia", async () => {
  db.prepare("UPDATE repos SET path = ?").run(join(root, "borrado"));
  const r = await planWith("MODE:ok");
  assert.deepEqual([r.ended.outcome, r.ended.failureReason], ["failed", "planner_failed"]);
  assert.deepEqual(leftovers(), []);
});
