import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { paths } from "@togi/daemon/config";
import { startDaemon } from "../../daemon/src/start.ts";
import { openEventDatabase } from "../../daemon/src/store/database.ts";
import { runCli } from "./testing/run-cli.ts";

/** Daemon real con su propio `TOGI_HOME` y 3 tareas; cada test recibe el suyo. */
async function withDaemon(body: (home: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "togi-verify-"));
  const home = join(root, "home");
  const daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
  try {
    for (let i = 0; i < 3; i++) {
      const r = await runCli(["task", "new", `Tarea ${i}`, "--risk", "low", "--repo", "o/r"], home);
      assert.equal(r.code, 0, r.stderr);
    }
    await body(home);
  } finally {
    await daemon.close();
    rmSync(root, { recursive: true, force: true });
  }
}

/** Quita los triggers y altera la fila 2, como en los tests del daemon. */
function tamper(home: string): void {
  const db = openEventDatabase(paths(home).database);
  try {
    db.exec("DROP TRIGGER events_no_update");
    db.prepare("UPDATE events SET payload = '{}' WHERE seq = 2").run();
  } finally {
    db.close();
  }
}

test("un log íntegro sale con 0 y una línea con ✓", () =>
  withDaemon(async (home) => {
    const r = await runCli(["admin", "verify-log", "--no-color"], home);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "✓ Log íntegro\n");
    assert.equal(r.stderr, "");
  }));

test("con --json, un log íntegro escribe la respuesta de la API", () =>
  withDaemon(async (home) => {
    const r = await runCli(["admin", "verify-log", "--json"], home);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { ok: true });
  }));

test("un log manipulado sale con 1 y nombra el evento roto", () =>
  withDaemon(async (home) => {
    tamper(home);
    const r = await runCli(["admin", "verify-log", "--no-color"], home);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^✗ El evento #2 del log no supera la verificación\./);
    assert.match(r.stderr, /manipulación/);
    assert.match(r.stderr, /No sigas trabajando hasta revisarlo/);
    assert.match(r.stderr, /integrity_error · req /);
  }));

test("con --json, un log manipulado escribe la respuesta de la API y sale con 1", () =>
  withDaemon(async (home) => {
    tamper(home);
    const r = await runCli(["admin", "verify-log", "--json"], home);
    assert.equal(r.code, 1);
    assert.deepEqual(JSON.parse(r.stdout), { ok: false, brokenAt: 2 });
    assert.match(r.stderr, /evento #2/);
  }));

test("sin daemon sale con 6", async () => {
  const root = mkdtempSync(join(tmpdir(), "togi-verify-"));
  try {
    const r = await runCli(["admin", "verify-log"], join(root, "vacio"));
    assert.equal(r.code, 6);
    assert.match(r.stderr, /No hay ningún daemon escuchando en el socket\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("un argumento de más es un error de uso (2)", () =>
  withDaemon(async (home) => {
    assert.equal((await runCli(["admin", "verify-log", "extra"], home)).code, 2);
  }));

test("la ayuda trae uso y ejemplo", async () => {
  const r = await runCli(["admin", "verify-log", "--help"], "/nonexistent");
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Ejemplo:\n {2}togi admin verify-log/);
});
