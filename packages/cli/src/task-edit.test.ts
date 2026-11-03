import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { erase } from "../../daemon/src/blobs/erase.ts";
import { FileBlobStore } from "../../daemon/src/blobs/file-blob-store.ts";
import { paths } from "../../daemon/src/config/app.ts";
import { DataKeyring } from "../../daemon/src/keys/data-keys.ts";
import { startDaemon } from "../../daemon/src/start.ts";
import { SqliteEventStore } from "../../daemon/src/store/event-store.ts";
import { createClient } from "./client.ts";
import { editTask } from "./commands/task-flow.ts";
import type { CliError } from "./errors.ts";
import { runCli } from "./testing/run-cli.ts";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
before(async () => {
  root = mkdtempSync(join(tmpdir(), "togi-edit-"));
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

test("editar el criterio se ve con show", async () => {
  const n = await create();
  const r = await runCli(["task", "edit", n, "--criteria", "Descarga un .csv", "--no-color"], home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `✓ Editada #${n}\n`);
  const text = (await runCli(["task", "show", n, "--no-color"], home)).stdout;
  assert.match(text, /Criterio de aceptación\n {2}Descarga un \.csv/);
});

test("vaciar la descripción la muestra como (vacío)", async () => {
  const n = await create("--description", "Algo");
  const r = await runCli(["task", "edit", n, "--description", ""], home);
  assert.equal(r.code, 0, r.stderr);
  const text = (await runCli(["task", "show", n, "--no-color"], home)).stdout;
  assert.match(text, /Descripción\n {2}\(vacío\)/);
});

test("un título vacío sale con 2 y no cambia nada", async () => {
  const n = await create();
  const before = await show(n);
  for (const title of ["", "  "]) {
    const r = await runCli(["task", "edit", n, "--title", title], home);
    assert.equal(r.code, 2);
  }
  assert.deepEqual(await show(n), before);
});

test("sin cambios no envía nada, avisa por stderr y la versión sigue igual", async () => {
  const n = await create("--criteria", "x");
  const before = await show(n);
  const r = await runCli(["task", "edit", n, "--criteria", "x", "--title", "Exportar CSV"], home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /no hay cambios/);
  assert.deepEqual(await show(n), before);
});

test("sin cambios, --json imprime la tarea leída del detalle", async () => {
  const n = await create("--criteria", "x");
  const r = await runCli(["task", "edit", n, "--criteria", "x", "--json"], home);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), await show(n));
  assert.match(r.stderr, /no hay cambios/);
});

test("vaciar un campo borrado sí se envía", async () => {
  const n = await create("--description", "Secreto");
  const keys = new DataKeyring(daemon.db, randomBytes(32));
  const deps = {
    events: new SqliteEventStore(daemon.db),
    keys,
    blobs: new FileBlobStore(paths(home).blobs, keys),
  };
  await erase(deps, Number(n), "task_text", "RGPD", { kind: "human", userId: daemon.userId });
  const before = await show(n);
  assert.equal(before.erased.description, true);
  const r = await runCli(["task", "edit", n, "--description", ""], home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.length > 0, true);
  assert.equal((await show(n)).version, before.version + 1);
});

test("una tarea en planning sale con 3, también sin cambios", async () => {
  const n = await create("--criteria", "x");
  await runCli(["task", "submit", n], home);
  for (const args of [
    ["--criteria", "y"],
    ["--criteria", "x"],
  ]) {
    const r = await runCli(["task", "edit", n, ...args], home);
    assert.equal(r.code, 3);
    assert.match(r.stderr, /no es posible en el estado actual/);
  }
});

test("un 412 entre la lectura y el envío sale con 4 y no reintenta", async () => {
  const n = await create();
  const error = (await editTask(
    home,
    n,
    { acceptanceCriteria: "z" },
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
  assert.deepEqual([after.title, after.version], ["Otro", 2]);
});

test("--json es la respuesta de la API", async () => {
  const n = await create();
  const r = await runCli(["task", "edit", n, "--title", "Nuevo título", "--json"], home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).number, Number(n));
});

test("sin ningún flag sale con 2 y nombra los flags", async () => {
  const n = await create();
  const r = await runCli(["task", "edit", n], home);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--title, --description o --criteria/);
});
