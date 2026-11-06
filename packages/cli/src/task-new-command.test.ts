import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import type { Created } from "./commands/create-task.ts";
import { newLines } from "./commands/new.ts";
import { createOutput } from "./output.ts";
import { runCli } from "./testing/run-cli.ts";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
before(async () => {
  root = mkdtempSync(join(tmpdir(), "togi-new-command-"));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
});
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

const tasks = () => (daemon.db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;

test("fuera de una terminal, togi new da error de uso con la alternativa y no crea nada", async () => {
  const before = tasks();
  const r = await runCli(["new", "--no-color"], home, { EDITOR: "true" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /togi new abre el editor y necesita una terminal/);
  assert.match(r.stderr, /togi task new --help/);
  assert.equal(tasks(), before);
});

test("con --json tampoco: el editor exige una terminal", async () => {
  const r = await runCli(["new", "--json"], home, { EDITOR: "true" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /new_needs_terminal/);
});

test("un título como argumento no vale: se escribe en el editor", async () => {
  const r = await runCli(["new", "Exportar CSV", "--no-color"], home);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /el título/);
});

const plain = createOutput({ env: { LANG: "es_ES.UTF-8" }, isTTY: false, noColorFlag: true });
const created = (over: Partial<Created> = {}): Created => ({
  number: 7,
  title: "Exportar CSV",
  titleErased: false,
  state: "draft",
  risk: "low",
  hasCriteria: true,
  ...over,
});

test("la salida: enviada, con lo deducido y la pista de seguimiento", () => {
  const text = newLines(
    {
      created: created(),
      deduced: { repo: "acme/app", baseBranch: "main" },
      submitted: { state: "planning" },
    },
    plain,
  );
  assert.equal(
    text,
    [
      "✓ Creada #7 «Exportar CSV» (riesgo bajo, draft)",
      "  Repo y rama base deducidos del directorio: acme/app → main",
      "✓ Enviada #7 a planning",
      "  Sigue el progreso con: togi watch · togi plan show 7",
      "",
    ].join("\n"),
  );
});

test("la salida con --draft dice cómo enviarla", () => {
  const text = newLines({ created: created(), deduced: undefined, submitted: null }, plain);
  assert.match(text, /Queda en draft \(--draft\): envíala con togi task submit 7\n$/);
  assert.doesNotMatch(text, /Sigue el progreso/);
});

test("la salida sin criterio lleva el aviso de siempre y no la pista de seguimiento", () => {
  const text = newLines(
    { created: created({ hasCriteria: false }), deduced: undefined, submitted: null },
    plain,
  );
  assert.match(text, /togi task edit 7 --criteria|task edit 7/);
  assert.doesNotMatch(text, /Sigue el progreso|--draft/);
});

test("la ayuda de togi new y la general lo mencionan", async () => {
  const help = await runCli(["new", "--help"], home);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Uso: togi new/);
  assert.match(help.stdout, /--draft/);
  const general = await runCli(["--help"], home);
  assert.match(general.stdout, /togi new {2}Crea una tarea con el editor/);
});
