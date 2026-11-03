import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { createClient } from "./client.ts";
import { submitTask } from "./commands/task-flow.ts";
import type { CliError } from "./errors.ts";
import { runCli } from "./testing/run-cli.ts";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
before(async () => {
  root = mkdtempSync(join(tmpdir(), "togi-submit-"));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
});
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

const create = async (...extra: string[]): Promise<string> => {
  const r = await runCli(
    ["task", "new", "Exportar CSV", "--risk", "low", "--repo", "o/r", ...extra, "--json"],
    home,
  );
  assert.equal(r.code, 0, r.stderr);
  return String(JSON.parse(r.stdout).number);
};
const show = async (n: string) =>
  JSON.parse((await runCli(["task", "show", n, "--json"], home)).stdout);

test("submit con criterio pasa a planning", async () => {
  const n = await create("--criteria", "Descarga un .csv");
  const r = await runCli(["task", "submit", n, "--no-color"], home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `✓ Enviada #${n} a planning\n`);
  assert.equal((await show(n)).state, "planning");
});

test("con --json, stdout es la respuesta de la API", async () => {
  const n = await create("--criteria", "x");
  const r = await runCli(["task", "submit", n, "--json"], home);
  assert.deepEqual(
    [JSON.parse(r.stdout).number, JSON.parse(r.stdout).state],
    [Number(n), "planning"],
  );
});

test("submit sin criterio sale con 3, da el siguiente paso y no cambia nada", async () => {
  const n = await create();
  const before = await show(n);
  const r = await runCli(["task", "submit", n, "--no-color"], home);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /no tiene criterio de aceptación/);
  assert.match(r.stderr, new RegExp(`togi task edit ${n}`));
  assert.deepEqual(await show(n), before);
});

test("sin número, con un número inválido o inexistente", async () => {
  assert.equal((await runCli(["task", "submit"], home)).code, 2);
  assert.equal((await runCli(["task", "submit", "abc"], home)).code, 2);
  assert.equal((await runCli(["task", "submit", "999"], home)).code, 7);
});

test("un 412 provocado entre la lectura y el envío sale con 4 y no reintenta", async () => {
  const n = await create("--criteria", "x");
  const error = (await submitTask(home, n, {
    afterRead: async () => {
      const api = createClient(home).api.v1.tasks[":n"];
      const res = await api.$patch(
        { param: { n } },
        {
          headers: { "if-match": '"1"', "content-type": "application/json" },
          init: { body: JSON.stringify({ title: "Otro" }) },
        },
      );
      assert.equal(res.status, 200);
    },
  }).catch((e: CliError) => e)) as CliError;
  assert.equal(error.exitCode, 4);
  assert.equal(error.code, "precondition_failed");
  const after = await show(n);
  assert.equal(after.state, "draft");
  assert.equal(after.version, 2);
});
