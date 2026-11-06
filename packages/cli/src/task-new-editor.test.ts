import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { type NewInput, newWithEditor } from "./commands/new.ts";
import type { CliError } from "./errors.ts";
import { runCli } from "./testing/run-cli.ts";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
const cwd = process.cwd();
before(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "togi-new-editor-")));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
});
afterEach(() => process.chdir(cwd));
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

let count = 0;
/** Un «editor»: un script que guarda lo que recibe en `seen` y, si devuelve algo, lo escribe. */
function editor(body: string): { argv: string[]; seen: string } {
  const id = count++;
  const path = join(root, `editor-${id}.js`);
  const seen = join(root, `seen-${id}.txt`);
  writeFileSync(
    path,
    `const fs = require("node:fs"); const f = process.argv[2]; const text = fs.readFileSync(f, "utf8");
fs.writeFileSync(${JSON.stringify(seen)}, text);
const out = (() => { ${body} })(); if (out !== undefined) fs.writeFileSync(f, out);`,
  );
  return { argv: [process.execPath, path], seen };
}
const fill = (title: string, extra: Record<string, string> = {}) =>
  editor(`let t = text.replace("#togi título\\n", "#togi título\\n" + ${JSON.stringify(title)} + "\\n");
${Object.entries(extra)
  .map(
    ([h, v]) =>
      `t = t.replace(${JSON.stringify(`#togi ${h}\n`)}, ${JSON.stringify(`#togi ${h}\n${v}\n`)});`,
  )
  .join("\n")}
return t;`);

const input = (over: Partial<NewInput> = {}): NewInput => ({
  risk: undefined,
  repo: "o/r",
  base: undefined,
  draft: false,
  ...over,
});
const tasks = () => (daemon.db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
const show = async (n: number) =>
  JSON.parse((await runCli(["task", "show", String(n), "--json"], home)).stdout);
const failure = async (p: Promise<unknown>): Promise<CliError> =>
  p.then(
    () => assert.fail("debía fallar"),
    (e) => e as CliError,
  );

test("con criterio, crea la tarea y la envía a planificar", async () => {
  const e = fill("Exportar CSV", { criterio: "Descarga un .csv" });
  const done = await newWithEditor(home, e.argv, input({ risk: "low" }));
  assert.ok(done);
  assert.equal(done.submitted?.state, "planning");
  const task = await show(done.created.number);
  assert.deepEqual(
    [task.state, task.risk, task.repo, task.baseBranch],
    ["planning", "low", "o/r", "dev"],
  );
});

test("la plantilla trae el riesgo sugerido, o el de --risk", async () => {
  const a = editor("return undefined;");
  await newWithEditor(home, a.argv, input());
  assert.match(readFileSync(a.seen, "utf8"), /#togi riesgo\n#togi low, medium o high\.\nmedium\n/);
  const b = editor("return undefined;");
  await newWithEditor(home, b.argv, input({ risk: "high" }));
  assert.match(readFileSync(b.seen, "utf8"), /#togi riesgo\n#togi low, medium o high\.\nhigh\n/);
});

test("el riesgo que se deja en la plantilla (medium) es el que se crea", async () => {
  const done = await newWithEditor(home, fill("Algo", { criterio: "c" }).argv, input());
  assert.equal((await show(done?.created.number ?? 0)).risk, "medium");
});

test("sin tocar la plantilla cancela: no se crea nada", async () => {
  const before = tasks();
  assert.equal(await newWithEditor(home, editor("return undefined;").argv, input()), null);
  assert.equal(await newWithEditor(home, editor('return "";').argv, input()), null);
  assert.equal(tasks(), before);
});

test("un título vacío con otros textos da invalid_option y no crea nada", async () => {
  const before = tasks();
  const e = editor(
    `return text.replace("#togi criterio\\n", "#togi criterio\\nSolo criterio\\n");`,
  );
  const error = await failure(newWithEditor(home, e.argv, input()));
  assert.equal(error.code, "invalid_option");
  assert.equal(error.exitCode, 2);
  assert.equal(error.context.field, "el título");
  assert.equal(tasks(), before);
});

test("un riesgo inválido en la plantilla da invalid_option --risk y no crea nada", async () => {
  const before = tasks();
  const bad = editor(
    `return text.replace("\\nmedium\\n", "\\nenorme\\n").replace("#togi título\\n", "#togi título\\nAlgo\\n");`,
  );
  const error = await failure(newWithEditor(home, bad.argv, input()));
  assert.equal(error.code, "invalid_option");
  assert.equal(error.context.field, "--risk");
  assert.equal(tasks(), before);
});

test("un --risk inválido falla antes de abrir el editor", async () => {
  const e = editor("return undefined;");
  const error = await failure(newWithEditor(home, e.argv, input({ risk: "enorme" })));
  assert.equal(error.context.field, "--risk");
  assert.equal(existsSync(e.seen), false);
});

test("sin criterio, la tarea se crea en draft y no se envía", async () => {
  const done = await newWithEditor(home, fill("Sin criterio").argv, input());
  assert.ok(done);
  assert.equal(done.submitted, null);
  assert.equal(done.created.hasCriteria, false);
  assert.equal((await show(done.created.number)).state, "draft");
});

test("con --draft y criterio, también se queda en draft", async () => {
  const done = await newWithEditor(
    home,
    fill("Borrador", { criterio: "c" }).argv,
    input({ draft: true }),
  );
  assert.equal(done?.submitted, null);
  assert.equal((await show(done?.created.number ?? 0)).state, "draft");
});

test("si el repo no se puede deducir, falla antes de abrir el editor y no crea nada", async () => {
  const outside = join(root, "fuera");
  mkdirSync(outside);
  process.chdir(outside);
  const e = editor("return undefined;");
  const before = tasks();
  const error = await failure(newWithEditor(home, e.argv, input({ repo: undefined })));
  assert.equal(error.code, "repo_not_inferred");
  assert.equal(existsSync(e.seen), false);
  assert.equal(tasks(), before);
});

test("la deducción del repo y de la rama (U1) se aplica a togi new", async () => {
  const dir = join(root, "clon");
  mkdirSync(dir);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", dir, ...args]);
  git("init", "-q");
  git("remote", "add", "origin", "git@github.com:acme/app.git");
  git("commit", "-q", "--allow-empty", "-m", "uno");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  const added = await runCli(["repo", "add", "acme/app", "--path", dir], home);
  assert.equal(added.code, 0, added.stderr);
  process.chdir(dir);
  const e = fill("Deducida", { criterio: "c" });
  const done = await newWithEditor(home, e.argv, input({ repo: undefined }));
  assert.ok(done);
  assert.match(readFileSync(e.seen, "utf8"), /Tarea nueva en acme\/app → main/);
  assert.deepEqual(done.deduced, { repo: "acme/app", baseBranch: "main" });
  const task = await show(done.created.number);
  assert.deepEqual([task.repo, task.baseBranch], ["acme/app", "main"]);
});
