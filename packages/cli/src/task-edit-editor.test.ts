import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { editWithEditor } from "./commands/task-flow.ts";
import type { CliError } from "./errors.ts";
import { runCli } from "./testing/run-cli.ts";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
before(async () => {
  root = mkdtempSync(join(tmpdir(), "togi-edit-editor-"));
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

let count = 0;
/** Un "editor": un script de Node que recibe el contenido del fichero en `text` y devuelve el nuevo. */
const editor = (body: string): string[] => {
  const path = join(root, `editor-${count++}.js`);
  writeFileSync(
    path,
    `const fs = require("node:fs"); const f = process.argv[2]; const text = fs.readFileSync(f, "utf8");
const out = (() => { ${body} })(); if (out !== undefined) fs.writeFileSync(f, out);`,
  );
  return [process.execPath, path];
};
const replace = (from: string, to: string) =>
  editor(`return text.replace(${JSON.stringify(from)}, ${JSON.stringify(to)});`);

test("editar el criterio en el editor se ve con show", async () => {
  const n = await create();
  const done = await editWithEditor(
    home,
    n,
    replace("#togi criterio\n", "#togi criterio\nDescarga\n"),
  );
  assert.equal(done?.changed, true);
  const text = (await runCli(["task", "show", n, "--no-color"], home)).stdout;
  assert.match(text, /Criterio de aceptación\n {2}Descarga/);
});

test("el fichero vacío cancela y no cambia nada", async () => {
  const n = await create();
  const before = await show(n);
  assert.equal(await editWithEditor(home, n, editor('return "";')), null);
  assert.deepEqual(await show(n), before);
});

test("sin tocar la plantilla no hay cambios y la versión sigue igual", async () => {
  const n = await create("--criteria", "x");
  const before = await show(n);
  const done = await editWithEditor(home, n, editor("return undefined;"));
  assert.equal(done?.changed, false);
  assert.deepEqual(await show(n), before);
});

test("un campo borrado aparece como comentario y nunca como texto", async () => {
  const n = await create("--description", "Secreto");
  const keys = new DataKeyring(daemon.db, randomBytes(32));
  const deps = {
    events: new SqliteEventStore(daemon.db),
    keys,
    blobs: new FileBlobStore(paths(home).blobs, keys),
  };
  await erase(deps, Number(n), "task_text", "RGPD", { kind: "human", userId: daemon.userId });
  const record = join(root, `seen-${n}.txt`);
  const seen = editor(`require("node:fs").writeFileSync(${JSON.stringify(record)}, text);`);
  // Todo el texto está borrado: la plantilla no tiene contenido y salir sin tocarla cancela.
  assert.equal(await editWithEditor(home, n, seen), null);
  const text = readFileSync(record, "utf8");
  assert.match(text, /#togi título\n#togi \[borrado\]/);
  assert.match(text, /#togi descripción\n#togi \[borrado\]/);
  assert.doesNotMatch(text, /Secreto/);
});

test("un texto con una línea #togi sale con 2 y el editor no llega a ejecutarse", async () => {
  const n = await create("--criteria", "a\n#togi nota");
  const ran = join(root, `ran-${n}.txt`);
  const error = (await editWithEditor(
    home,
    n,
    editor(`require("node:fs").writeFileSync(${JSON.stringify(ran)}, "x");`),
  ).catch((e: CliError) => e)) as CliError;
  assert.deepEqual([error.exitCode, error.code], [2, "edit_editor_unsafe"]);
  assert.equal(existsSync(ran), false);
});

test("un título en blanco sale con 2 y no cambia nada", async () => {
  const n = await create();
  const before = await show(n);
  const error = (await editWithEditor(
    home,
    n,
    editor(
      'return text.replace("#togi título\\nExportar CSV\\n", "#togi título\\n").replace("#togi criterio\\n", "#togi criterio\\nC\\n");',
    ),
  ).catch((e: CliError) => e)) as CliError;
  assert.equal(error.exitCode, 2);
  assert.deepEqual(await show(n), before);
});

test("un 412 sale con 4 y no reintenta: el ETag es el de antes del editor", async () => {
  const n = await create();
  const error = (await editWithEditor(home, n, replace("#togi criterio\n", "#togi criterio\nZ\n"), {
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
  }).catch((e: CliError) => e)) as CliError;
  assert.equal(error.exitCode, 4);
  const after = await show(n);
  assert.deepEqual([after.title, after.version, after.acceptanceCriteria], ["Otro", 2, null]);
});

test("sin terminal, task edit sin flags sale con 2 aunque haya EDITOR", async () => {
  const n = await create();
  const r = await runCli(["task", "edit", n], home, { EDITOR: "true", VISUAL: "true" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--title, --description o --criteria/);
});
