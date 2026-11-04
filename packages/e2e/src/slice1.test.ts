import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  eraseTaskText,
  paths,
  type RunningCli,
  rawRequest,
  runCli,
  spawnCli,
  withDatabase,
} from "./harness.ts";

let home: string;
let watcher: RunningCli | undefined;
const togi = (...args: string[]) => runCli(args, home);
const ok = async (...args: string[]) => {
  const r = await togi(...args);
  assert.equal(r.code, 0, `togi ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

before(() => {
  home = mkdtempSync(join(tmpdir(), "togi-e2e-"));
});

after(async () => {
  watcher?.child.kill();
  await togi("daemon", "stop");
  try {
    process.kill(Number(readFileSync(paths(home).pid, "utf8")), "SIGKILL");
  } catch {} // ya parado
  rmSync(home, { recursive: true, force: true });
});

describe("rebanada 1, de extremo a extremo", { concurrency: false }, () => {
  it("arranca el daemon real y lo reporta en marcha", async () => {
    assert.match(await ok("daemon", "start"), /en marcha|arrancado/i);
    assert.match(await ok("daemon", "status"), /Daemon en marcha/);
  });

  it("flujo de tareas, con watch recibiendo exactamente sus eventos", async () => {
    watcher = spawnCli(["watch", "--json", "--from-start"], home);
    const created = JSON.parse(
      await ok(
        "task",
        "new",
        "Exportar CSV",
        "--risk",
        "low",
        "--repo",
        "a/b",
        "--description",
        "datos personales",
        "--json",
      ),
    );
    assert.equal(created.number, 1);
    const status = await ok("status");
    assert.match(status, /Pendiente de ti/);
    assert.match(status, /falta criterio/);
    assert.equal((await togi("task", "submit", "1")).code, 3);

    await ok("task", "edit", "1", "--criteria", "Descarga un .csv");
    assert.match(await ok("task", "submit", "1"), /planning/);
    assert.match(await ok("task", "show", "1"), /planning/);
    assert.match(await ok("status"), /planning/);

    await ok("task", "new", "Borrar logs", "--risk", "low", "--repo", "a/b");
    await ok("task", "reject", "2", "--category", "scope", "--reason", "Duplica la #1", "--yes");
    assert.doesNotMatch(await ok("status"), /Borrar logs/);
    assert.match(await ok("status", "--all"), /Borrar logs/);

    const types = await untilEvents(watcher, EXPECTED.length);
    assert.deepEqual(types, EXPECTED);
    watcher.child.kill();
    watcher = undefined;
  });

  it("reiniciar el daemon conserva las tareas y verify-log da 0", async () => {
    await ok("daemon", "stop");
    await ok("daemon", "start");
    const all = await ok("status", "--all");
    assert.match(all, /Exportar CSV/);
    assert.match(all, /Borrar logs/);
    assert.match(await ok("admin", "verify-log"), /./);
  });

  it("erase de task_text: show lo marca [borrado] y verify-log sigue en 0", async () => {
    await ok("daemon", "stop");
    assert.notEqual(await eraseTaskText(home, 1), null);
    await ok("daemon", "start");
    assert.match(await ok("task", "show", "1"), /\[borrado\]/);
    await ok("admin", "verify-log");
  });

  it("una manipulación del log arranca normal y verify-log sale con 1 nombrando el evento", async () => {
    await ok("daemon", "stop");
    const seq = await withDatabase(home, (db) => {
      db.exec("DROP TRIGGER events_no_update");
      const row = db.prepare("SELECT seq FROM events ORDER BY seq LIMIT 1 OFFSET 2").get() as {
        seq: number;
      };
      db.prepare("UPDATE events SET at = '2000-01-01T00:00:00.000Z' WHERE seq = ?").run(row.seq);
      return row.seq;
    });
    await ok("daemon", "start");
    const r = await togi("admin", "verify-log");
    assert.equal(r.code, 1);
    assert.ok(new RegExp(`\\b${seq}\\b`).test(r.stderr), r.stderr);
    const json = await togi("admin", "verify-log", "--json");
    assert.deepEqual(JSON.parse(json.stdout), { ok: false, brokenAt: seq });
  });

  it("sin token o con token inválido, 401", async () => {
    assert.equal(await rawRequest(home, "/v1/tasks"), 401);
    assert.equal(await rawRequest(home, "/v1/tasks", "Bearer no-es-un-token"), 401);
  });
});

const EXPECTED = ["task.created", "task.edited", "task.submitted", "task.created", "task.rejected"];

async function untilEvents(w: RunningCli, count: number): Promise<string[]> {
  const deadline = Date.now() + 10_000;
  const lines = () => w.stdout().split("\n").filter(Boolean);
  while (lines().length < count && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 50));
  return lines().map((l) => JSON.parse(l).type as string);
}
