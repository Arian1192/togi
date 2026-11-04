import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { decidePlan } from "./commands/plan-decide.ts";
import { type CliError, renderError } from "./errors.ts";
import { createOutput } from "./output.ts";
import { runCli } from "./testing/run-cli.ts";
import { seedPlans } from "./testing/seed-plan.ts";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
let seed: Awaited<ReturnType<typeof seedPlans>>["plan"];
let requestChanges: Awaited<ReturnType<typeof seedPlans>>["requestChanges"];
before(async () => {
  root = mkdtempSync(join(tmpdir(), "togi-plan-decide-"));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
  ({ plan: seed, requestChanges } = await seedPlans(home, daemon));
});
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

const REASON = ["--category", "scope", "--reason", "Divídelo en dos"];
const show = async (n: string) =>
  JSON.parse((await runCli(["task", "show", n, "--json"], home)).stdout);

/** Una tarea con un plan v1 en plan_review. */
async function inReview(title = "Exportar CSV", plan = {}): Promise<string> {
  const made = await runCli(
    ["task", "new", title, "--risk", "low", "--repo", "o/r", "--criteria", "c", "--json"],
    home,
  );
  const n = String(JSON.parse(made.stdout).number);
  assert.equal((await runCli(["task", "submit", n], home)).code, 0);
  await seed(Number(n), plan);
  assert.equal((await show(n)).state, "plan_review");
  return n;
}

test("approve lleva la tarea a building", async () => {
  const n = await inReview();
  const r = await runCli(["plan", "approve", n, "--no-color"], home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `✓ Aprobado el plan de #${n} · building\n`);
  assert.equal((await show(n)).state, "building");
});

test("approve con --json devuelve la respuesta de la API", async () => {
  const n = await inReview();
  const r = await runCli(["plan", "approve", n, "--json"], home);
  assert.equal(JSON.parse(r.stdout).state, "building");
});

test("request-changes vuelve a planning y sale con 0", async () => {
  const n = await inReview();
  const r = await runCli(["plan", "request-changes", n, ...REASON, "--no-color"], home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `✓ Pedidos cambios sobre el plan de #${n} · vuelve a planning\n`);
  assert.equal((await show(n)).state, "planning");
});

test("request-changes exige categoría y motivo válidos y no cambia nada", async () => {
  const n = await inReview();
  const none = await runCli(["plan", "request-changes", n], home);
  const bad = await runCli(
    ["plan", "request-changes", n, "--category", "x", "--reason", "a"],
    home,
  );
  const blank = await runCli(
    ["plan", "request-changes", n, "--category", "scope", "--reason", " "],
    home,
  );
  assert.deepEqual([none.code, bad.code, blank.code], [2, 2, 2]);
  assert.equal((await show(n)).state, "plan_review");
});

test("reject con --yes cierra la tarea", async () => {
  const n = await inReview();
  const r = await runCli(["plan", "reject", n, ...REASON, "--yes", "--no-color"], home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `✓ Rechazado el plan de #${n}: la tarea queda cerrada\n`);
  assert.equal((await show(n)).state, "rejected");
});

test("reject sin --yes fuera de una terminal sale con 2 y no cambia nada", async () => {
  const n = await inReview();
  const r = await runCli(["plan", "reject", n, ...REASON], home);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /necesita confirmación/);
  assert.equal((await show(n)).state, "plan_review");
});

test("la confirmación de reject nombra la tarea y limpia caracteres de control", async () => {
  const n = await inReview("Mal\x1b[31mo\x07");
  const asked: string[] = [];
  const done = await decidePlan(home, n, "reject", {
    category: "scope",
    text: "x",
    confirm: async (q) => {
      asked.push(q);
      return true;
    },
  });
  assert.equal(done?.state, "rejected");
  assert.equal(
    asked[0],
    `¿Rechazar el plan de #${n} «Mal[31mo»? Es definitivo: la tarea queda cerrada. [s/N]`,
  );
  assert.doesNotMatch(asked[0] as string, /\p{Cc}/u);
});

test("si la persona cancela reject no se envía nada", async () => {
  const n = await inReview();
  const done = await decidePlan(home, n, "reject", {
    category: "scope",
    text: "x",
    confirm: async () => false,
  });
  assert.equal(done, null);
  assert.equal((await show(n)).state, "plan_review");
});

for (const verb of ["approve", "request-changes", "reject"] as const) {
  test(`${verb}: un 412 tras la lectura del plan es plan_changed, sale con 4 y no reintenta`, async () => {
    const n = await inReview();
    const error = (await decidePlan(
      home,
      n,
      verb,
      { category: "scope", text: "x" },
      { afterRead: () => requestChanges(Number(n), 1) },
    ).catch((e: CliError) => e)) as CliError;
    assert.equal(error.code, "plan_changed");
    assert.equal(error.exitCode, 4);
    // Solo se registró la petición de cambios del hook: la tarea sigue en planning, sin decisión extra.
    assert.equal((await show(n)).state, "planning");
  });
}

test("plan_changed dice que hay que releer el plan, no repetir el comando", async () => {
  const n = await inReview();
  const error = (await decidePlan(
    home,
    n,
    "approve",
    {},
    { afterRead: () => requestChanges(Number(n), 1) },
  ).catch((e: CliError) => e)) as CliError;
  const out = createOutput({ env: { LANG: "es_ES.UTF-8" }, isTTY: false, noColorFlag: true });
  const text = renderError(error, out);
  assert.match(text, /cambió antes de que se registrara tu decisión/);
  assert.match(text, new RegExp(`Léelo de nuevo antes de decidir: togi plan show ${n}`));
  assert.doesNotMatch(text, /Repite/);
});

test("un plan que pasa de los límites no se aprueba: sale con 3 y sigue en plan_review", async () => {
  const n = await inReview("Grande", { production: 500, tests: 10 });
  const r = await runCli(["plan", "approve", n, "--no-color"], home);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /supera los límites/);
  assert.equal((await show(n)).state, "plan_review");
});

test("decidir un plan ya decidido sale con 3 y no cambia nada", async () => {
  const n = await inReview();
  assert.equal((await runCli(["plan", "approve", n], home)).code, 0);
  const r = await runCli(["plan", "approve", n], home);
  assert.equal(r.code, 3);
  assert.equal((await show(n)).state, "building");
});

test("una tarea sin plan sale con 7", async () => {
  const made = await runCli(
    ["task", "new", "Sin plan", "--risk", "low", "--repo", "o/r", "--json"],
    home,
  );
  assert.equal(made.code, 0, made.stderr);
  const n = String(JSON.parse(made.stdout).number);
  assert.equal((await runCli(["plan", "approve", n], home)).code, 7);
});

test("argumentos inválidos salen con 2", async () => {
  const none = await runCli(["plan", "approve"], home);
  const bad = await runCli(["plan", "approve", "abc"], home);
  assert.deepEqual([none.code, bad.code], [2, 2]);
});
