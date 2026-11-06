import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { FakePlanner } from "../../daemon/src/testing/fake-planner.ts";
import { runCli } from "./testing/run-cli.ts";

type Daemon = Awaited<ReturnType<typeof startDaemon>>;
let root: string;
let planned: { home: string; daemon: Daemon };
let bare: { home: string; daemon: Daemon };
let failures = 0;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "togi-plan-retry-"));
  const env = { TOGI_KEYCHAIN: "file" };
  const homeA = join(root, "a");
  planned = {
    home: homeA,
    daemon: await startDaemon(homeA, env, {
      planner: new FakePlanner(() => failures-- > 0),
      plannerStatus: { state: "active", reason: "agente real" },
    }),
  };
  const homeB = join(root, "b");
  bare = { home: homeB, daemon: await startDaemon(homeB, env) };
  for (const { daemon } of [planned, bare]) {
    daemon.db
      .prepare("INSERT INTO repos (repo, path, added_at) VALUES ('o/r', '/clon', 'x')")
      .run();
  }
});
after(async () => {
  await planned.daemon.close();
  await bare.daemon.close();
  rmSync(root, { recursive: true, force: true });
});

async function newTask(home: string, submit: boolean): Promise<string> {
  const made = await runCli(
    ["task", "new", "Exportar", "--risk", "low", "--repo", "o/r", "--criteria", "c", "--json"],
    home,
  );
  const n = String(JSON.parse(made.stdout).number);
  if (submit) assert.equal((await runCli(["task", "submit", n], home)).code, 0);
  return n;
}
const stateOf = async (home: string, n: string) =>
  JSON.parse((await runCli(["task", "show", n, "--json"], home)).stdout).state as string;
/** Espera (hasta 5 s) a que el orquestador deje la tarea en ese estado. */
async function reaches(home: string, n: string, state: string): Promise<string> {
  let current = await stateOf(home, n);
  for (let i = 0; i < 100 && current !== state; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    current = await stateOf(home, n);
  }
  return current;
}
/** Espera a que la tarea tenga `count` sesiones cerradas: así se sabe que el fallo ya ocurrió. */
async function sessionsEnded(daemon: Daemon, n: string, count: number): Promise<void> {
  const sql = "SELECT COUNT(*) AS c FROM sessions WHERE task_number = ? AND state = 'ended'";
  for (let i = 0; i < 100; i++) {
    if ((daemon.db.prepare(sql).get(Number(n)) as { c: number }).c >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`la tarea ${n} no llegó a ${count} sesiones cerradas`);
}

test("plan retry pide otra sesión: tras un fallo, la tarea llega a plan_review", async () => {
  failures = 1; // la primera sesión falla, la segunda completa
  const n = await newTask(planned.home, true);
  await sessionsEnded(planned.daemon, n, 1);
  assert.equal(await stateOf(planned.home, n), "planning");
  const r = await runCli(["plan", "retry", n, "--no-color"], planned.home);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`Pedida otra sesión de planificación para #${n}`));
  assert.equal(await reaches(planned.home, n, "plan_review"), "plan_review");
});

test("--json devuelve la respuesta de la API", async () => {
  failures = 1;
  const n = await newTask(planned.home, true);
  await sessionsEnded(planned.daemon, n, 1);
  const r = await runCli(["plan", "retry", n, "--json"], planned.home);
  assert.equal(r.code, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.number, Number(n));
  assert.equal(body.state, "planning");
  await reaches(planned.home, n, "plan_review");
});

test("sin número o con un número inválido da error de uso", async () => {
  for (const args of [[], ["abc"], ["0"], ["1", "2"]]) {
    const r = await runCli(["plan", "retry", ...args], planned.home);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.stderr, /togi plan retry --help/);
  }
});

test("una tarea que no está en planning da el error de la regla, sin lanzar nada", async () => {
  const n = await newTask(planned.home, false); // draft
  const r = await runCli(["plan", "retry", n, "--no-color"], planned.home);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Esta acción no es posible en el estado actual/);
});

test("una tarea inexistente da task_not_found", async () => {
  const r = await runCli(["plan", "retry", "999"], planned.home);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /La tarea #999 no existe/);
});

test("un daemon sin planificador activo responde con su error y no escribe nada", async () => {
  const n = await newTask(bare.home, true);
  const before = bare.daemon.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
  const r = await runCli(["plan", "retry", n, "--no-color"], bare.home);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /planificador/i);
  const after = bare.daemon.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
  assert.equal(after.n, before.n);
});
