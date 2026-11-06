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
let idle: { home: string; daemon: Daemon };
before(async () => {
  root = mkdtempSync(join(tmpdir(), "togi-invalid-state-"));
  const env = { TOGI_KEYCHAIN: "file" };
  const a = join(root, "a");
  planned = { home: a, daemon: await startDaemon(a, env, { planner: new FakePlanner() }) };
  const b = join(root, "b");
  idle = { home: b, daemon: await startDaemon(b, env) }; // sin planificador: se queda en planning
  for (const { daemon } of [planned, idle]) {
    daemon.db
      .prepare("INSERT INTO repos (repo, path, added_at) VALUES ('o/r', '/clon', 'x')")
      .run();
  }
});
after(async () => {
  await planned.daemon.close();
  await idle.daemon.close();
  rmSync(root, { recursive: true, force: true });
});

async function create(home: string, submit: boolean): Promise<string> {
  const made = await runCli(
    ["task", "new", "Exportar", "--risk", "low", "--repo", "o/r", "--criteria", "c", "--json"],
    home,
  );
  const n = String(JSON.parse(made.stdout).number);
  if (submit) assert.equal((await runCli(["task", "submit", n], home)).code, 0);
  return n;
}
async function inReview(n: string) {
  for (let i = 0; i < 100; i++) {
    const task = JSON.parse((await runCli(["task", "show", n, "--json"], planned.home)).stdout);
    if (task.state === "plan_review") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`la tarea ${n} no llegó a plan_review`);
}
const run = (home: string, ...args: string[]) => runCli([...args, "--no-color"], home);

test("editar una tarea en planning dice en qué estado está y qué hacer", async () => {
  const n = await create(idle.home, true);
  const r = await run(idle.home, "task", "edit", n, "--title", "otro");
  assert.equal(r.code, 3);
  assert.match(r.stderr, new RegExp(`#${n} está en planning, la planifica el agente`));
  assert.match(r.stderr, new RegExp(`togi plan retry ${n}`));
  assert.match(r.stderr, /invalid_state/);
});

test("editar con el plan ya propuesto remite a togi plan request-changes", async () => {
  const n = await create(planned.home, true);
  await inReview(n);
  const r = await run(planned.home, "task", "edit", n, "--title", "otro");
  assert.equal(r.code, 3);
  assert.match(r.stderr, new RegExp(`#${n} está en plan_review, espera tu decisión`));
  assert.match(r.stderr, new RegExp(`togi plan request-changes ${n} \\(para cambiarlo\\)`));
});

test("enviar otra vez una tarea ya enviada dice su estado", async () => {
  const n = await create(idle.home, true);
  const r = await run(idle.home, "task", "submit", n);
  assert.equal(r.code, 3);
  assert.match(r.stderr, new RegExp(`#${n} está en planning`));
});

test("togi plan retry sobre una tarea en draft dice que sigue en draft y cómo enviarla", async () => {
  const n = await create(planned.home, false);
  const r = await run(planned.home, "plan", "retry", n);
  assert.equal(r.code, 3);
  assert.match(r.stderr, new RegExp(`#${n} está en draft, aún no tiene plan`));
  assert.match(r.stderr, new RegExp(`togi task submit ${n}`));
});
