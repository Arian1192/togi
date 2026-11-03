import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { runCli } from "./testing/run-cli.ts";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
before(async () => {
  root = mkdtempSync(join(tmpdir(), "togi-task-"));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
});
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

const NEW = ["task", "new", "Exportar CSV", "--risk", "low", "--repo", "o/r"];
const count = () => (daemon.db.prepare("SELECT count(*) AS n FROM tasks").get() as { n: number }).n;

test("task new con criterio: una línea con el resultado, como en la guía", async () => {
  const r = await runCli([...NEW, "--criteria", "Descarga un .csv"], home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "✓ Creada #1 «Exportar CSV» (riesgo bajo, draft)\n");
});

test("sin criterio, la salida indica el siguiente paso", async () => {
  const r = await runCli([...NEW, "-r", "high"], home);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^✓ Creada #\d+ «Exportar CSV» \(riesgo alto, draft\)\n/);
  assert.match(r.stdout, /\n {2}Falta el criterio de aceptación: togi task edit \d+\n$/);
});

test("con --json, stdout es JSON válido con la respuesta de la API", async () => {
  const r = await runCli([...NEW, "--base", "main", "--description", "algo", "--json"], home);
  const task = JSON.parse(r.stdout);
  assert.deepEqual(
    [task.title, task.risk, task.repo, task.baseBranch, task.hasCriteria],
    ["Exportar CSV", "low", "o/r", "main", false],
  );
});

test("un riesgo inválido sale con 2 y nombra el flag", async () => {
  const r = await runCli(["task", "new", "Algo", "--risk", "extremo", "--repo", "o/r"], home);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--risk/);
  assert.equal(r.stdout, "");
});

test("un campo de la API se traduce a su flag", async () => {
  const crit = await runCli([...NEW, "--criteria", "x".repeat(20_001)], home);
  assert.equal(crit.code, 2);
  assert.match(crit.stderr, /--criteria/);
  const repo = await runCli(["task", "new", "Algo", "--risk", "low", "--repo", "mal"], home);
  assert.match(repo.stderr, /--repo/);
});

test("faltan el título, --risk o --repo, o sobran palabras: sale con 2", async () => {
  for (const args of [
    ["task", "new", "--risk", "low", "--repo", "o/r"],
    ["task", "new", "Algo", "--repo", "o/r"],
    ["task", "new", "Algo", "--risk", "low"],
    ["task", "new", "Filtro", "por", "fecha", "--risk", "low", "--repo", "o/r"],
  ]) {
    assert.equal((await runCli(args, home)).code, 2, args.join(" "));
  }
});

test("dos ejecuciones con el mismo --idempotency-key crean una sola tarea", async () => {
  const before = count();
  const args = [...NEW, "--idempotency-key", "clave-1", "--json"];
  const first = JSON.parse((await runCli(args, home)).stdout);
  const second = JSON.parse((await runCli(args, home)).stdout);
  assert.equal(second.number, first.number);
  assert.equal(count(), before + 1);
});

test("sin --idempotency-key cada ejecución genera la suya y crea su tarea", async () => {
  const before = count();
  await runCli(NEW, home);
  await runCli(NEW, home);
  assert.equal(count(), before + 2);
});

test("la misma clave con otro contenido sale con 3; una clave insegura, con 2", async () => {
  await runCli([...NEW, "--idempotency-key", "clave-2"], home);
  const reused = await runCli(
    ["task", "new", "Otra cosa", "--risk", "low", "--repo", "o/r", "--idempotency-key", "clave-2"],
    home,
  );
  assert.equal(reused.code, 3);
  assert.equal((await runCli([...NEW, "--idempotency-key", "con espacios"], home)).code, 2);
});

test("el título no mueve la terminal y la ayuda documenta la clave", async () => {
  const r = await runCli(
    ["task", "new", "\x1b[31mrojo\x1b[0m", "--risk", "low", "--repo", "o/r"],
    home,
  );
  assert.ok(!r.stdout.includes("\x1b"), r.stdout);
  const help = await runCli(["task", "new", "--help"], home);
  assert.match(help.stdout, /--idempotency-key {2}Repetir el comando con la misma clave/);
});
