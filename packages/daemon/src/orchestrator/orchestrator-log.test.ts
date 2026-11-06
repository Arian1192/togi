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
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { FakePlanner } from "../testing/fake-planner.ts";
import { createOrchestrator } from "./orchestrator.ts";
import type { Planner, PlanOutcome } from "./planner.ts";

// Por partes: ningún detector de secretos lo ve como una clave en el código fuente.
const KEY = ["sk", "ant", "api03", "B".repeat(40)].join("-");
// biome-ignore lint/suspicious/noControlCharactersInRegex: es justo lo que se comprueba
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const human: Actor = { kind: "human", userId: "usr_1" };
const usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, durationMs: 0 };

let home: string;
let db: Database.Database;
let store: SqliteEventStore;
let handle: ReturnType<typeof createHandler>;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-orq-log-"));
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

/** Planifica una tarea de acme/app con ese planificador y devuelve las líneas que escribió el orquestador. */
async function logOf(planner: Planner, { registered = true } = {}) {
  if (registered) {
    db.prepare("INSERT INTO repos (repo, path, added_at) VALUES ('acme/app', '/clon', 'x')").run();
  }
  const log = mock.method(console, "error", () => {});
  try {
    const orchestrator = createOrchestrator({ db, store, handle, planner });
    orchestrator.start();
    const made = await handle(human, {
      type: "create",
      title: "Filtro",
      description: "d",
      acceptanceCriteria: "c",
      risk: "low",
      repo: "acme/app",
      baseBranch: "main",
      source: { kind: "cli" },
    });
    assert.ok("number" in made);
    await handle(human, { type: "submit", number: made.number });
    await orchestrator.idle();
    await orchestrator.close();
    return { number: made.number, lines: log.mock.calls.map((c) => String(c.arguments[0])) };
  } finally {
    log.mock.restore();
  }
}
const failing = (outcome: () => PlanOutcome | Promise<PlanOutcome>): Planner => ({
  identity: new FakePlanner().identity,
  plan: async () => outcome(),
});
const only = (lines: string[]) => {
  assert.equal(lines.length, 1, lines.join("\n"));
  return lines[0] as string;
};

test("un repo sin registrar dice la tarea, el motivo y el comando para registrarlo", async () => {
  const { number, lines } = await logOf(new FakePlanner(), { registered: false });
  const line = only(lines);
  assert.match(
    line,
    new RegExp(`^orquestador: la tarea ${number} no se planifica \\(repo_not_registered\\): `),
  );
  assert.match(line, /el repo de la tarea no está registrado/);
  assert.match(
    line,
    new RegExp(
      `siguiente paso: registra el repo con togi repo add acme/app --path <ruta> y reintenta con togi plan retry ${number}$`,
    ),
  );
});

test("un fallo del planificador lleva su código y el siguiente paso de ese código", async () => {
  const { number, lines } = await logOf(
    failing(() => ({
      ok: false,
      code: "credential_missing",
      reason: "falta la credencial",
      usage,
    })),
  );
  const line = only(lines);
  assert.match(
    line,
    new RegExp(
      `el planificador falló en la tarea ${number} \\(credential_missing\\): "falta la credencial"`,
    ),
  );
  assert.match(
    line,
    /siguiente paso: configura una credencial con togi auth set-api-key o togi auth use-subscription/,
  );
});

test("un planificador que lanza: su error, sin secretos ni escapes, y cómo reintentar", async () => {
  const { number, lines } = await logOf(
    failing(() => {
      throw new Error(`clave ${KEY}\u001b[31m roja\u009b2J\nsegunda línea`);
    }),
  );
  const line = only(lines);
  assert.match(line, new RegExp(`el planificador lanzó en la tarea ${number} \\(planner_error\\)`));
  assert.match(line, /Error: clave \[REDACTED:anthropic-api-key\]/);
  assert.ok(!line.includes("B".repeat(40)), "la clave no debe llegar al log");
  assert.ok(!CONTROL.test(line), "ni escapes ni saltos de línea sin escapar");
  assert.match(line, new RegExp(`siguiente paso: reintenta con togi plan retry ${number}$`));
});

test("un plan inválido dice invalid_plan y qué hacer", async () => {
  const bad = failing(() => ({
    ok: true,
    usage,
    plan: {
      files: [{ path: "../fuera", change: "modify" }],
      newTests: [],
      approach: "x",
      estimatedLines: { production: 1, tests: 1 },
      baseSha: "abc",
    },
  }));
  const { number, lines } = await logOf(bad);
  const line = only(lines);
  assert.match(line, new RegExp(`plan rechazado en la tarea ${number} \\(invalid_plan\\)`));
  assert.match(
    line,
    /siguiente paso: el agente no propuso un plan válido: reintenta con togi plan retry/,
  );
});

test("todas las líneas son una sola línea que empieza por «orquestador:» y nombra la tarea", async () => {
  const cases = [await logOf(new FakePlanner(), { registered: false })];
  for (const { number, lines } of cases) {
    for (const line of lines) {
      assert.ok(line.startsWith("orquestador: "), line);
      assert.ok(!line.includes("\n"), line);
      assert.ok(line.includes(`tarea ${number}`), line);
    }
  }
});
