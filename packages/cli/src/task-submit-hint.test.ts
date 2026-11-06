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
  root = mkdtempSync(join(tmpdir(), "togi-submit-hint-"));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
});
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

const create = async (): Promise<string> => {
  const r = await runCli(
    ["task", "new", "Exportar CSV", "--risk", "low", "--repo", "o/r", "--criteria", "c", "--json"],
    home,
  );
  assert.equal(r.code, 0, r.stderr);
  return String(JSON.parse(r.stdout).number);
};

test("submit dice cómo seguir el progreso por stderr y deja stdout como estaba", async () => {
  const n = await create();
  const r = await runCli(["task", "submit", n, "--no-color"], home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `✓ Enviada #${n} a planning\n`);
  assert.equal(r.stderr, `Sigue el progreso con: togi watch · togi plan show ${n}\n`);
});

test("con --json no hay pista: stdout es la respuesta y stderr queda vacío", async () => {
  const n = await create();
  const r = await runCli(["task", "submit", n, "--json"], home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).number, Number(n));
  assert.equal(r.stderr, "");
});
