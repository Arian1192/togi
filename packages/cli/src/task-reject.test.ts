import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { createClient } from "./client.ts";
import { rejectTask } from "./commands/task-flow.ts";
import type { CliError } from "./errors.ts";
import { runCli } from "./testing/run-cli.ts";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
before(async () => {
  root = mkdtempSync(join(tmpdir(), "togi-reject-"));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
});
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

const create = async (title = "Exportar CSV"): Promise<string> => {
  const r = await runCli(["task", "new", title, "--risk", "low", "--repo", "o/r", "--json"], home);
  assert.equal(r.code, 0, r.stderr);
  return String(JSON.parse(r.stdout).number);
};
const show = async (n: string) =>
  JSON.parse((await runCli(["task", "show", n, "--json"], home)).stdout);
const REJECT = ["--category", "scope", "--reason", "Duplica la #9"];

test("reject con --yes deja la tarea en rejected", async () => {
  const n = await create();
  const r = await runCli(["task", "reject", n, ...REJECT, "--yes", "--no-color"], home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `✓ Rechazada #${n}\n`);
  assert.equal((await show(n)).state, "rejected");
});

test("con --json, stdout es la respuesta de la API", async () => {
  const n = await create();
  const r = await runCli(["task", "reject", n, ...REJECT, "-y", "--json"], home);
  assert.equal(JSON.parse(r.stdout).state, "rejected");
});

test("sin --yes fuera de una terminal sale con 2 y no cambia nada", async () => {
  const n = await create();
  const before = await show(n);
  const r = await runCli(["task", "reject", n, ...REJECT], home);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /necesita confirmación/);
  assert.deepEqual(await show(n), before);
});

test("categoría inválida y motivo vacío salen con 2 y no cambian nada", async () => {
  const n = await create();
  const before = await show(n);
  const bad = await runCli(["task", "reject", n, "--category", "x", "--reason", "a", "-y"], home);
  const blank = await runCli(
    ["task", "reject", n, "--category", "scope", "--reason", "  ", "-y"],
    home,
  );
  const none = await runCli(["task", "reject", n, "-y"], home);
  assert.deepEqual([bad.code, blank.code, none.code], [2, 2, 2]);
  assert.match(bad.stderr, /misunderstanding, scope, logic, tests, style, other/);
  assert.deepEqual(await show(n), before);
});

test("una tarea ya rechazada sale con 3", async () => {
  const n = await create();
  await runCli(["task", "reject", n, ...REJECT, "-y"], home);
  const r = await runCli(["task", "reject", n, ...REJECT, "-y"], home);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /ya está cerrada/);
});

test("un 412 entre la lectura y el envío sale con 4 y no reintenta", async () => {
  const n = await create();
  const error = (await rejectTask(
    home,
    n,
    { category: "scope", text: "x" },
    {
      afterRead: async () => {
        const res = await createClient(home).api.v1.tasks[":n"].$patch(
          { param: { n } },
          {
            headers: { "if-match": '"1"', "content-type": "application/json" },
            init: { body: JSON.stringify({ title: "Otro" }) },
          },
        );
        assert.equal(res.status, 200);
      },
    },
  ).catch((e: CliError) => e)) as CliError;
  assert.equal(error.exitCode, 4);
  const after = await show(n);
  assert.deepEqual([after.state, after.version], ["draft", 2]);
});

test("la confirmación nombra la tarea y limpia los caracteres de control del título", async () => {
  const n = await create("Mal\x1b[31mo\x07");
  const asked: string[] = [];
  const done = await rejectTask(home, n, {
    category: "scope",
    text: "x",
    confirm: async (q) => {
      asked.push(q);
      return true;
    },
  });
  assert.equal(done?.state, "rejected");
  assert.equal(asked.length, 1);
  assert.equal(
    asked[0],
    `¿Rechazar #${n} «Mal[31mo»? Es definitivo: la tarea queda cerrada. [s/N]`,
  );
  assert.doesNotMatch(asked[0] as string, /\p{Cc}/u);
});

test("si la persona cancela no se envía nada", async () => {
  const n = await create();
  const done = await rejectTask(home, n, {
    category: "scope",
    text: "x",
    confirm: async () => false,
  });
  assert.equal(done, null);
  assert.equal((await show(n)).state, "draft");
});
