import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Planner, PlanOutcome } from "../../daemon/src/orchestrator/planner.ts";
import { startDaemon } from "../../daemon/src/start.ts";
import { FakePlanner } from "../../daemon/src/testing/fake-planner.ts";
import { followTask } from "./commands/follow.ts";
import { runNew } from "./commands/new.ts";
import { type CliError, renderError } from "./errors.ts";
import { createOutput } from "./output.ts";
import { runCli } from "./testing/run-cli.ts";

type Daemon = Awaited<ReturnType<typeof startDaemon>>;
const out = createOutput({ env: { LANG: "es_ES.UTF-8" }, isTTY: false, noColorFlag: true });
const usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, durationMs: 0 };

let root: string;
let count = 0;
before(() => {
  root = mkdtempSync(join(tmpdir(), "togi-follow-"));
});
after(() => rmSync(root, { recursive: true, force: true }));

/** Un daemon de prueba con ese planificador (o sin ninguno) y el repo o/r registrado. */
async function withDaemon(
  planner: Planner | undefined,
  fn: (home: string, d: Daemon) => Promise<void>,
) {
  const home = join(root, `home-${count++}`);
  const daemon = await startDaemon(
    home,
    { TOGI_KEYCHAIN: "file" },
    planner === undefined ? {} : { planner },
  );
  daemon.db.prepare("INSERT INTO repos (repo, path, added_at) VALUES ('o/r', '/clon', 'x')").run();
  try {
    await fn(home, daemon);
  } finally {
    await daemon.close();
  }
}

/** Un planificador que no termina hasta que se libera: una sesión en curso. */
function blocking() {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const inner = new FakePlanner();
  const planner: Planner = {
    identity: inner.identity,
    plan: async (request) => {
      await gate;
      return inner.plan(request);
    },
  };
  return { planner, release };
}

const create = async (home: string, submit: boolean): Promise<string> => {
  const r = await runCli(
    ["task", "new", "Exportar CSV", "--risk", "low", "--repo", "o/r", "--criteria", "c", "--json"],
    home,
  );
  assert.equal(r.code, 0, r.stderr);
  const n = String(JSON.parse(r.stdout).number);
  if (submit) assert.equal((await runCli(["task", "submit", n], home)).code, 0);
  return n;
};
const ctx = (home: string, signal = new AbortController().signal) => {
  const written: string[] = [];
  return { home, out, signal, write: (t: string) => void written.push(t), written };
};
const failure = async (p: Promise<unknown>): Promise<CliError> =>
  p.then(
    () => assert.fail("debía fallar"),
    (e) => e as CliError,
  );
const FAST = { pollMs: 20 };

test("hasta el plan: lo cuenta como togi plan show y dice qué hacer después", async () => {
  await withDaemon(new FakePlanner(), async (home) => {
    const n = await create(home, true);
    const c = ctx(home);
    const text = await followTask(c, n, { baseline: 0, ...FAST });
    const shown = (await runCli(["plan", "show", n, "--no-color"], home)).stdout;
    assert.ok(text.startsWith(shown), "el plan sale con el mismo formato que plan show");
    assert.match(text, /Plan listo: apruébalo con togi plan approve \d+ o pide cambios/);
    assert.deepEqual(c.written.join("").split("\n").filter(Boolean), [
      `Esperando a que el planificador empiece con #${n}…`,
      "Sesión de planificación en curso…",
    ]);
  });
});

test("si la sesión falla, error con su motivo y el siguiente paso, y sale con 1", async () => {
  await withDaemon(new FakePlanner(() => true), async (home) => {
    const n = await create(home, true);
    const error = await failure(followTask(ctx(home), n, { baseline: 0, ...FAST }));
    assert.deepEqual(
      [error.code, error.exitCode, error.context.reason],
      ["follow_session_failed", 1, "planner_failed"],
    );
    const text = renderError(error, out);
    assert.match(text, /La planificación de #\d+ falló: el planificador no logró proponer un plan/);
    assert.match(text, new RegExp(`togi plan retry ${n}`));
  });
});

test("sin credencial, el fallo lleva el siguiente paso de las credenciales", async () => {
  const planner: Planner = {
    identity: new FakePlanner().identity,
    plan: async (): Promise<PlanOutcome> => ({
      ok: false,
      code: "credential_missing",
      reason: "falta la credencial del agente",
      usage,
    }),
  };
  await withDaemon(planner, async (home) => {
    const n = await create(home, true);
    const error = await failure(followTask(ctx(home), n, { baseline: 0, ...FAST }));
    assert.match(renderError(error, out), /togi auth set-api-key.*togi auth use-subscription/);
  });
});

test("sin planificador activo, no espera sin fin: lo dice con su estado y remite al log, y sale con 1", async () => {
  await withDaemon(undefined, async (home) => {
    const n = await create(home, true);
    const error = await failure(
      followTask(ctx(home), n, { baseline: 0, sessionWaitMs: 200, ...FAST }),
    );
    assert.deepEqual([error.code, error.exitCode], ["follow_no_session", 1]);
    const text = renderError(error, out);
    assert.match(text, /sin que empiece ninguna sesión de planificación de #\d+/);
    assert.match(text, /El planificador está desactivado: no se configuró ningún planificador/);
    assert.match(text, /~\/\.togi\/run\/daemon\.log/);
  });
});

test("con el planificador activo pero ocupado, dice que puede estar en cola y no culpa al planificador", async () => {
  const busy = blocking();
  await withDaemon(busy.planner, async (home) => {
    const first = await create(home, true); // ocupa al planificador
    const second = await create(home, true); // espera su turno
    const error = await failure(
      followTask(ctx(home), second, { baseline: 0, sessionWaitMs: 300, ...FAST }),
    );
    assert.equal(error.code, "follow_no_session");
    const text = renderError(error, out);
    assert.match(text, /Puede estar en cola tras otra tarea/);
    assert.doesNotMatch(text, /El planificador está/);
    busy.release();
    assert.ok(first);
  });
});

test("Ctrl+C deja de seguir: sin error, la tarea y la sesión siguen", async () => {
  const busy = blocking();
  await withDaemon(busy.planner, async (home, daemon) => {
    const n = await create(home, true);
    const abort = new AbortController();
    const c = ctx(home, abort.signal);
    const following = followTask(c, n, { baseline: 0, ...FAST });
    while (!c.written.join("").includes("Sesión de planificación en curso")) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    abort.abort();
    const text = await following;
    assert.match(text, new RegExp(`Dejo de seguir #${n}: la tarea continúa`));
    assert.match(text, new RegExp(`togi plan show ${n} o togi watch`));
    const state = (sql: string) => daemon.db.prepare(sql).get(Number(n)) as { s: string };
    assert.equal(state("SELECT state AS s FROM tasks WHERE number = ?").s, "planning");
    assert.equal(state("SELECT state AS s FROM sessions WHERE task_number = ?").s, "active");
    busy.release();
  });
});

test("solo cuentan las sesiones posteriores al seguimiento: tras un fallo, el reintento", async () => {
  let failures = 1;
  await withDaemon(new FakePlanner(() => failures-- > 0), async (home, daemon) => {
    const n = await create(home, true);
    const ended = "SELECT COUNT(*) AS c FROM sessions WHERE task_number = ? AND state = 'ended'";
    while ((daemon.db.prepare(ended).get(Number(n)) as { c: number }).c < 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // Sin baseline: parte de la sesión fallida que ya hay y espera la siguiente.
    const following = followTask(ctx(home), n, FAST);
    assert.equal((await runCli(["plan", "retry", n], home)).code, 0);
    assert.match(await following, /Plan listo/);
  });
});

let editors = 0;
const editor = (home: string, title: string, criteria: string): string[] => {
  const path = join(root, `editor-${editors++}.js`);
  writeFileSync(
    path,
    `const fs = require("node:fs"); const f = process.argv[2]; let t = fs.readFileSync(f, "utf8");
t = t.replace("#togi título\\n", "#togi título\\n${title}\\n").replace("#togi criterio\\n", "#togi criterio\\n${criteria}\\n");
fs.writeFileSync(f, t);`,
  );
  assert.ok(home);
  return [process.execPath, path];
};
const input = { risk: undefined, repo: "o/r", base: undefined, draft: false };

test("togi new de principio a fin: crea, envía, sigue y termina con el plan", async () => {
  await withDaemon(new FakePlanner(), async (home) => {
    const c = ctx(home);
    const text = await runNew(
      c,
      editor(home, "Exportar CSV", "Descarga un .csv"),
      input,
      "c",
      FAST,
    );
    const shown = c.written.join("");
    assert.match(shown, /Creada #\d+ «Exportar CSV»/);
    assert.match(shown, /Enviada #\d+ a planning/);
    assert.match(shown, /Esperando a que el planificador empiece/);
    assert.match(text, /plan · versión 1/);
    assert.match(text, /Plan listo/);
  });
});

test("togi new --draft no sigue nada y no abre ninguna sesión", async () => {
  await withDaemon(new FakePlanner(), async (home, daemon) => {
    const c = ctx(home);
    const text = await runNew(
      c,
      editor(home, "Borrador", "criterio"),
      { ...input, draft: true },
      "c",
      FAST,
    );
    assert.match(text, /Queda en draft/);
    assert.deepEqual(c.written, []);
    assert.equal(
      (daemon.db.prepare("SELECT COUNT(*) AS c FROM sessions").get() as { c: number }).c,
      0,
    );
  });
});

test("togi new con un planificador que falla termina con el error de la sesión", async () => {
  await withDaemon(new FakePlanner(() => true), async (home) => {
    const error = await failure(
      runNew(ctx(home), editor(home, "Fallará", "criterio"), input, "c", FAST),
    );
    assert.equal(error.code, "follow_session_failed");
    assert.equal(error.exitCode, 1);
  });
});
