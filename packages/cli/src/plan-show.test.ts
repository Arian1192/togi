import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { runCli } from "./testing/run-cli.ts";
import { seedPlans } from "./testing/seed-plan.ts";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
let seed: Awaited<ReturnType<typeof seedPlans>>["plan"];
let requestChanges: Awaited<ReturnType<typeof seedPlans>>["requestChanges"];
before(async () => {
  root = mkdtempSync(join(tmpdir(), "togi-plan-show-"));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
  ({ plan: seed, requestChanges } = await seedPlans(home, daemon));
});
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

/** Crea y envía una tarea con la CLI; devuelve su número. */
async function submitted(): Promise<string> {
  const made = await runCli(
    ["task", "new", "Exportar CSV", "--risk", "low", "--repo", "o/r", "--criteria", "c", "--json"],
    home,
  );
  const n = String(JSON.parse(made.stdout).number);
  assert.equal((await runCli(["task", "submit", n], home)).code, 0);
  return n;
}

test("show muestra ficheros con su cambio, tests, enfoque, líneas, base y versión", async () => {
  const n = await submitted();
  await seed(Number(n), { approach: "Filtrar en el repositorio\ny exponerlo" });
  const r = await runCli(["plan", "show", n, "--no-color"], home);
  assert.equal(r.code, 0, r.stderr);
  const pad = " ".repeat(n.length + 3);
  assert.equal(
    r.stdout,
    [
      `#${n}  plan · versión 1`,
      `${pad}base abc123 · ~10 líneas de producción · ~20 de tests (estimadas)`,
      "",
      "Ficheros",
      "  modificar  src/a.ts",
      "  añadir     src/b.ts",
      "",
      "Tests nuevos",
      "  src/a.test.ts",
      "",
      "Enfoque",
      "  Filtrar en el repositorio",
      "  y exponerlo",
      "",
    ].join("\n"),
  );
});

test("un plan sobre el límite de producción o de total avisa", async () => {
  for (const sizes of [{ production: 201 }, { production: 200, tests: 301 }]) {
    const n = await submitted();
    await seed(Number(n), sizes);
    const r = await runCli(["plan", "show", n, "--no-color"], home);
    assert.match(r.stdout, /Supera los límites \(200 de producción, 500 en total\)/);
  }
  const ok = await submitted();
  await seed(Number(ok), { production: 200, tests: 300 });
  assert.doesNotMatch((await runCli(["plan", "show", ok], home)).stdout, /Supera/);
});

test("el enfoque no mueve la terminal: se quitan los caracteres de control", async () => {
  const n = await submitted();
  await seed(Number(n), { approach: "a\u001b[2Jb\u0007c" });
  const r = await runCli(["plan", "show", n, "--no-color"], home);
  assert.match(r.stdout, / {2}a\[2Jbc\n/);
  assert.ok(!r.stdout.includes("\u001b") && !r.stdout.includes("\u0007"));
});

test("--version enseña una anterior sin enfoque; una inexistente sale con 7", async () => {
  const n = await submitted();
  await seed(Number(n), { approach: "uno" });
  await requestChanges(Number(n), 1);
  await seed(Number(n), { approach: "dos" });
  const current = await runCli(["plan", "show", n, "--no-color"], home);
  assert.match(current.stdout, /versión 2/);
  assert.match(current.stdout, / {2}dos\n/);
  const old = await runCli(["plan", "show", n, "--version", "1", "--no-color"], home);
  assert.match(old.stdout, /versión 1/);
  assert.match(old.stdout, /Enfoque no disponible en versiones anteriores/);
  assert.doesNotMatch(old.stdout, /uno/);
  const missing = await runCli(["plan", "show", n, "--version", "9"], home);
  assert.equal(missing.code, 7);
  assert.match(missing.stderr, /no tiene la versión 9 del plan/);
});

test("--json escribe la respuesta de la API", async () => {
  const n = await submitted();
  await seed(Number(n));
  const body = JSON.parse((await runCli(["plan", "show", n, "--json"], home)).stdout);
  assert.deepEqual(
    [body.planVersion, body.baseSha, body.estimatedLines, body.previous],
    [1, "abc123", { production: 10, tests: 20 }, []],
  );
});

test("sin plan sale con 7 y sugiere task show; el número y la versión se validan", async () => {
  const n = await submitted();
  const none = await runCli(["plan", "show", n], home);
  assert.equal(none.code, 7);
  assert.match(none.stderr, /no tiene plan/);
  assert.equal((await runCli(["plan", "show"], home)).code, 2);
  assert.equal((await runCli(["plan", "show", "x"], home)).code, 2);
  assert.equal((await runCli(["plan", "show", n, "--version", "0"], home)).code, 2);
  assert.match((await runCli(["plan", "show", "--help"], home)).stdout, /Ejemplo:/);
});

test("task show enseña la versión del plan vigente, y nada si no hay plan", async () => {
  const n = await submitted();
  assert.doesNotMatch((await runCli(["task", "show", n], home)).stdout, /plan v/);
  await seed(Number(n));
  const shown = await runCli(["task", "show", n, "--no-color"], home);
  assert.match(shown.stdout, /plan_review · riesgo bajo · o\/r → dev · versión \d+ · plan v1/);
});
