import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { readRelease } from "@togi/daemon/release";
import { CliError } from "./errors.ts";
import { install, update } from "./install.ts";
import { plistPath, type Runner } from "./launchd.ts";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
let root: string;
let repo: string;
let source: string;
let calls: string[][];

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, env: GIT_ENV, encoding: "utf8" }).trim();

/** Mueve la etiqueta a un commit nuevo, como cuando se vuelve a publicar una versión. */
function moveTag(tag: string, content: string): string {
  writeFileSync(join(repo, "a.txt"), content);
  git("add", ".");
  git("commit", "-q", "-m", content);
  git("tag", "-f", tag);
  return git("rev-parse", "HEAD");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "togi-existing-"));
  repo = join(root, "origen");
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  moveTag("v1.0.0", "primero");
  source = `file://${repo}`;
  calls = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** git es el real; pnpm y launchctl se anotan sin ejecutarse. */
const run: Runner = async (cmd, args) => {
  calls.push([cmd, ...args]);
  return cmd === "git" ? execFileSync(cmd, args, { env: GIT_ENV, encoding: "utf8" }) : "";
};
const deps = () => ({
  run,
  supportDir: join(root, "support"),
  agentsDir: join(root, "agents"),
  uid: 501,
  node: "/usr/local/bin/node",
  platform: "darwin" as const,
  source,
});
const home = () => join(root, "togi-home");
const plist = () => plistPath(join(root, "agents"));
const releaseDir = (tag: string) => join(root, "support", "releases", tag);

for (const verb of ["install", "update"] as const) {
  const act = (tag: string) => (verb === "install" ? install : update)(home(), tag, deps());

  test(`${verb}: una carpeta existente del mismo commit que la etiqueta se reutiliza`, async () => {
    const first = await install(home(), "v1.0.0", deps());
    calls = [];
    const again = await act("v1.0.0");
    assert.equal(again.commit, first.commit);
    assert.ok(!calls.some((c) => c[0] === "git" && c[1] === "clone"), "no se vuelve a clonar");
    assert.ok(!calls.some((c) => c[0] === "pnpm"), "ni se reinstalan las dependencias");
    assert.ok(
      calls.some((c) => c[0] === "launchctl" && c[1] === "bootstrap"),
      "se activa",
    );
  });

  test(`${verb}: si la etiqueta apunta ahora a otro commit, se niega y no activa nada`, async () => {
    const old = (await install(home(), "v1.0.0", deps())).commit;
    const moved = moveTag("v1.0.0", "otro commit");
    assert.notEqual(moved, old);
    const before = {
      plist: readFileSync(plist(), "utf8"),
      launcher: readFileSync(join(root, "support", "bin", "togi"), "utf8"),
    };
    calls = [];
    await assert.rejects(act("v1.0.0"), (e) => {
      assert.ok(e instanceof CliError);
      assert.equal(e.code, `${verb}_failed`);
      const detail = e.context.detail ?? "";
      assert.ok(detail.includes(old.slice(0, 7)), `dice el commit instalado: ${detail}`);
      assert.ok(detail.includes(moved.slice(0, 7)), `dice el commit de la etiqueta: ${detail}`);
      assert.match(detail, /v1\.0\.0/);
      assert.ok(detail.includes(releaseDir("v1.0.0")), "dice qué carpeta borrar");
      // Primero lo recomendable (una etiqueta nueva) y, como segunda opción, borrar la carpeta.
      const nueva = detail.indexOf("publica una etiqueta nueva");
      const borrar = detail.indexOf("rm -rf");
      assert.ok(nueva >= 0 && borrar > nueva, `orden de las sugerencias: ${detail}`);
      assert.match(detail, /las etiquetas de versión no se reutilizan/);
      return true;
    });
    assert.ok(!calls.some((c) => c[0] === "launchctl"), "no se toca launchctl");
    assert.ok(!calls.some((c) => c[0] === "pnpm"), "ni se instala nada");
    assert.equal(readFileSync(plist(), "utf8"), before.plist, "el plist no cambia");
    assert.equal(readFileSync(join(root, "support", "bin", "togi"), "utf8"), before.launcher);
    assert.deepEqual(readRelease(releaseDir("v1.0.0"))?.commit, old, "la carpeta no se toca");
  });
}

test("install: una carpeta sin RELEASE válido tampoco se reutiliza", async () => {
  mkdirSync(releaseDir("v1.0.0"), { recursive: true });
  writeFileSync(join(releaseDir("v1.0.0"), "RELEASE"), "roto");
  await assert.rejects(
    install(home(), "v1.0.0", deps()),
    (e) => e instanceof CliError && e.code === "install_failed",
  );
  assert.ok(!existsSync(plist()), "sin plist");
  assert.ok(!calls.some((c) => c[0] === "launchctl"));
});

test("install: si la etiqueta ya no existe en el origen, se niega a reutilizar la carpeta", async () => {
  await install(home(), "v1.0.0", deps());
  git("tag", "-d", "v1.0.0");
  calls = [];
  await assert.rejects(install(home(), "v1.0.0", deps()), (e) => {
    assert.ok(e instanceof CliError);
    assert.match(e.context.detail ?? "", /ya no existe/);
    return true;
  });
  assert.ok(!calls.some((c) => c[0] === "launchctl"));
});

test("una etiqueta anotada se compara por el commit al que apunta, no por el objeto de la etiqueta", async () => {
  git("tag", "-d", "v1.0.0");
  git("tag", "-a", "-m", "anotada", "v1.0.0");
  const first = await install(home(), "v1.0.0", deps());
  assert.equal(first.commit, git("rev-parse", "v1.0.0^{commit}"));
  const again = await install(home(), "v1.0.0", deps());
  assert.equal(again.commit, first.commit, "una etiqueta anotada sin cambios se reutiliza");
});
