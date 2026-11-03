import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { paths } from "@togi/daemon/config";
import { erase } from "../../daemon/src/blobs/erase.ts";
import { FileBlobStore } from "../../daemon/src/blobs/file-blob-store.ts";
import { DataKeyring } from "../../daemon/src/keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../../daemon/src/keys/master-key.ts";
import { selectKeychain } from "../../daemon/src/keys/select-keychain.ts";
import { startDaemon } from "../../daemon/src/start.ts";
import { SqliteEventStore } from "../../daemon/src/store/event-store.ts";
import { runCli } from "./testing/run-cli.ts";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
before(async () => {
  root = mkdtempSync(join(tmpdir(), "togi-show-"));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
});
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

const NEW = ["task", "new", "Exportar CSV", "--risk", "low", "--repo", "o/r"];
/** Crea una tarea con la CLI y devuelve su número. */
const create = async (...extra: string[]): Promise<string> => {
  const r = await runCli([...NEW, ...extra, "--json"], home);
  assert.equal(r.code, 0, r.stderr);
  return String(JSON.parse(r.stdout).number);
};

test("crear y ver con show: la salida sigue la guía", async () => {
  const n = await create("--criteria", "Descarga un .csv");
  const shown = await runCli(["task", "show", n, "--no-color"], home);
  assert.equal(shown.code, 0, shown.stderr);
  assert.equal(
    shown.stdout,
    [
      `#${n}  Exportar CSV`,
      "     draft · riesgo bajo · o/r → dev · versión 1",
      "",
      "Descripción",
      "  (vacío)",
      "",
      "Criterio de aceptación",
      "  Descarga un .csv",
      "",
    ].join("\n"),
  );
});

test("show muestra la rama base y los textos de varias líneas con sangría", async () => {
  const n = await create("--base", "main", "--description", "uno\ndos", "-r", "high");
  const out = (await runCli(["task", "show", n, "--no-color"], home)).stdout;
  assert.match(out, /draft · riesgo alto · o\/r → main · versión 1/);
  assert.match(out, /Descripción\n {2}uno\n {2}dos\n/);
});

test("con --json, stdout es JSON válido con la respuesta de la API", async () => {
  const n = await create();
  const shown = JSON.parse((await runCli(["task", "show", n, "--json"], home)).stdout);
  assert.deepEqual(
    [shown.number, shown.title, shown.repo, shown.baseBranch, shown.version],
    [Number(n), "Exportar CSV", "o/r", "dev", 1],
  );
});

test("una tarea inexistente sale con 7 y nombra la tarea", async () => {
  const r = await runCli(["task", "show", "999"], home);
  assert.equal(r.code, 7);
  assert.match(r.stderr, /La tarea #999 no existe\./);
});

test("sin número o con un número inválido sale con 2", async () => {
  for (const args of [
    ["task", "show"],
    ["task", "show", "abc"],
    ["task", "show", "0"],
    ["task", "show", "1", "2"],
  ]) {
    assert.equal((await runCli(args, home)).code, 2, args.join(" "));
  }
});

test("un texto borrado con erase aparece como [borrado], en gris con color", async () => {
  const n = await create("--description", "datos personales");
  const keys = new DataKeyring(
    daemon.db,
    await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } })),
  );
  const deps = {
    events: new SqliteEventStore(daemon.db),
    keys,
    blobs: new FileBlobStore(paths(home).blobs, keys),
  };
  await erase(deps, Number(n), "task_text", "prueba", { kind: "human", userId: daemon.userId });
  const plain = await runCli(["task", "show", n, "--no-color"], home);
  assert.match(plain.stdout, /Descripción\n {2}\[borrado\]\n/);
  const color = await runCli(["task", "show", n], home, { FORCE_COLOR: "1" });
  assert.ok(color.stdout.includes("\x1b[90m[borrado]\x1b[0m"), color.stdout);
});

test("el título, la descripción y el criterio no mueven la terminal", async () => {
  const made = await runCli(
    ["task", "new", "\x1b[31mTítulo\x07 raro", "--risk", "low", "--repo", "o/r", "--json"].concat([
      "--description",
      "\x1b[31mrojo\x1b[0m",
      "--criteria",
      "ok\x07",
    ]),
    home,
  );
  assert.equal(made.code, 0, made.stderr);
  const n = String(JSON.parse(made.stdout).number);
  const out = (await runCli(["task", "show", n, "--no-color"], home)).stdout;
  assert.ok(!out.includes("\x1b") && !out.includes("\x07"), JSON.stringify(out));
  assert.match(out, /^#\d+ {2}\[31mTítulo raro\n/);
  assert.match(out, /\[31mrojo/);
});

test("una descripción y un criterio que nunca se escribieron aparecen como (vacío), no como [borrado]", async () => {
  const n = await create();
  const out = (await runCli(["task", "show", n, "--no-color"], home)).stdout;
  assert.match(out, /Descripción\n {2}\(vacío\)\n\nCriterio de aceptación\n {2}\(vacío\)\n$/);
  assert.ok(!out.includes("[borrado]"), out);
  const color = await runCli(["task", "show", n], home, { FORCE_COLOR: "1" });
  assert.equal(color.stdout.split("\x1b[90m(vacío)\x1b[0m").length - 1, 2, color.stdout);
});

test("task show --help trae el uso y un ejemplo", async () => {
  const r = await runCli(["task", "show", "--help"], home);
  assert.match(r.stdout, /Uso: togi task show <número>/);
  assert.match(r.stdout, /Ejemplo:\n {2}togi task show 12/);
});
