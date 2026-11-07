import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { completeTask } from "./commands/task-flow.ts";
import { runCli } from "./testing/run-cli.ts";
import { seedPlans } from "./testing/seed-plan.ts";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
let seed: Awaited<ReturnType<typeof seedPlans>>["plan"];
before(async () => {
  root = mkdtempSync(join(tmpdir(), "togi-done-"));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
  ({ plan: seed } = await seedPlans(home, daemon));
});
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

const show = async (n: string) =>
  JSON.parse((await runCli(["task", "show", n, "--json"], home)).stdout);

/** Una tarea con el plan aprobado: en building. `upTo` la deja antes. */
async function task(
  upTo: "draft" | "plan_review" | "building" = "building",
  title = "Exportar CSV",
) {
  const made = await runCli(
    ["task", "new", title, "--risk", "low", "--repo", "o/r", "--criteria", "c", "--json"],
    home,
  );
  const n = String(JSON.parse(made.stdout).number);
  if (upTo === "draft") return n;
  assert.equal((await runCli(["task", "submit", n], home)).code, 0);
  await seed(Number(n));
  if (upTo === "plan_review") return n;
  assert.equal((await runCli(["plan", "approve", n], home)).code, 0);
  assert.equal((await show(n)).state, "building");
  return n;
}

test("done --pr N --yes deja la tarea en merged y avisa de que el PR es una referencia", async () => {
  const n = await task();
  const r = await runCli(["task", "done", n, "--pr", "125", "--yes", "--no-color"], home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `✓ Hecha #${n} · PR #125 (referencia tuya; togi no la verifica)\n`);
  assert.equal((await show(n)).state, "merged");
});

test("con --json, stdout es la respuesta de la API", async () => {
  const n = await task();
  const r = await runCli(["task", "done", n, "--pr", "7", "-y", "--json"], home);
  assert.equal(JSON.parse(r.stdout).state, "merged");
});

test("sin --yes fuera de una terminal sale con 2, pide --yes y no cambia nada", async () => {
  const n = await task();
  const before = await show(n);
  const r = await runCli(["task", "done", n, "--pr", "125"], home);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Marcar #\d+ como hecha necesita confirmación/);
  assert.match(r.stderr, /--yes/);
  assert.deepEqual(await show(n), before);
});

test("--pr ausente o no es un entero positivo: sale con 2 y no cambia nada", async () => {
  const n = await task();
  const before = await show(n);
  const none = await runCli(["task", "done", n, "--yes"], home);
  assert.equal(none.code, 2);
  assert.match(none.stderr, /--pr/);
  for (const bad of ["abc", "0", "-3", "1.5", "12x", "", "99999999999999999999"]) {
    const r = await runCli(["task", "done", n, "--pr", bad, "--yes"], home);
    assert.equal(r.code, 2, `--pr ${JSON.stringify(bad)}`);
    assert.match(r.stderr, /--pr/);
  }
  assert.deepEqual(await show(n), before);
});

test("falta el número de tarea o no es válido: sale con 2", async () => {
  assert.equal((await runCli(["task", "done", "--pr", "1", "--yes"], home)).code, 2);
  assert.equal((await runCli(["task", "done", "x", "--pr", "1", "--yes"], home)).code, 2);
});

test("la confirmación nombra la tarea y el PR, dice que togi no lo comprueba, y cancelar no cambia nada", async () => {
  const n = await task("building", "Informe mensual");
  const before = await show(n);
  let asked = "";
  const cancelled = await completeTask(home, n, {
    prNumber: 99,
    confirm: async (q) => {
      asked = q;
      return false;
    },
  });
  assert.equal(cancelled, null);
  assert.match(asked, /¿Marcar #\d+ «Informe mensual» como hecha, con el PR #99\?/);
  assert.match(asked, /togi no comprueba el PR/);
  assert.match(asked, /definitivo/);
  assert.deepEqual(await show(n), before);
  const done = await completeTask(home, n, { prNumber: 99, confirm: async () => true });
  assert.equal(done?.state, "merged");
});

test("fuera de building no se puede: el error dice el estado y no cambia nada", async () => {
  for (const upTo of ["draft", "plan_review"] as const) {
    const n = await task(upTo);
    const r = await runCli(["task", "done", n, "--pr", "125", "--yes", "--no-color"], home);
    assert.notEqual(r.code, 0, upTo);
    assert.match(r.stderr, new RegExp(upTo), upTo);
    assert.equal((await show(n)).state, upTo);
  }
});

test("una tarea ya hecha no se puede completar otra vez", async () => {
  const n = await task();
  assert.equal((await runCli(["task", "done", n, "--pr", "1", "-y"], home)).code, 0);
  const again = await runCli(["task", "done", n, "--pr", "2", "-y"], home);
  assert.notEqual(again.code, 0);
  assert.equal((await show(n)).state, "merged");
});

test("togi status deja de mostrar la tarea en curso y la cuenta como fusionada", async () => {
  const n = await task("building", "Para el status");
  const before = await runCli(["status", "--no-color"], home);
  assert.match(before.stdout, new RegExp(`#${n}\\b`));
  await runCli(["task", "done", n, "--pr", "5", "-y"], home);
  const after = await runCli(["status", "--no-color"], home);
  assert.doesNotMatch(after.stdout, new RegExp(`#${n}\\b`));
  assert.match(after.stdout, /fusionadas?/);
});

test("la ayuda de done explica que el PR es una referencia que togi no verifica", async () => {
  const r = await runCli(["task", "done", "--help"], home);
  assert.match(r.stdout, /Uso: togi task done <número> --pr <número del PR> \[--yes\]/);
  assert.match(r.stdout, /no tiene acceso a GitHub y no comprueba que exista/);
  assert.match(r.stdout, /building/);
});
