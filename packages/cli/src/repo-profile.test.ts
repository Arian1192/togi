import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { setRepoProfile } from "./commands/repo.ts";
import { runCli } from "./testing/run-cli.ts";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
before(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "togi-repo-profile-cli-")));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
});
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

const cli = (...args: string[]) => runCli([...args, "--no-color"], home);

/** Registra un clon de `acme/<name>` y devuelve su owner/repo. */
const register = async (name: string): Promise<string> => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "remote", "add", "origin", `git@github.com:acme/${name}.git`]);
  const r = await cli("repo", "add", `acme/${name}`, "--path", dir);
  assert.equal(r.code, 0, r.stderr);
  return `acme/${name}`;
};

const PROFILE = {
  install: "pnpm install --frozen-lockfile",
  checks: { typecheck: "pnpm typecheck", lint: "pnpm lint", test: "pnpm test" },
  testFiles: ["**/*.test.ts"],
  protectedPaths: [],
  docs: ["docs/**", "**/*.md"],
  registry: ["registry.npmjs.org"],
  testExclude: [],
};

let files = 0;
/** Escribe un fichero con ese contenido (JSON si no es texto) y devuelve su ruta. */
const file = (content: unknown): string => {
  const path = join(root, `perfil-${++files}.json`);
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
};
const shown = async (repo: string) =>
  JSON.parse((await cli("repo", "profile", repo, "--json")).stdout);

test("sin perfil sale con 7 y dice cómo fijarlo; un repo no registrado, también con 7", async () => {
  const repo = await register("vacio");
  const r = await cli("repo", "profile", repo);
  assert.equal(r.code, 7);
  assert.match(r.stderr, /acme\/vacio no tiene perfil\./);
  assert.match(r.stderr, /togi repo profile acme\/vacio --set <fichero\.json>/);
  const missing = await cli("repo", "profile", "acme/nada");
  assert.equal(missing.code, 7);
  assert.match(missing.stderr, /acme\/nada no está registrado/);
  assert.match(missing.stderr, /togi repo list/);
});

test("--set con --yes fija un perfil nuevo, lo enseña antes y show lo muestra", async () => {
  const repo = await register("nuevo");
  const r = await cli("repo", "profile", repo, "--set", file(PROFILE), "--yes");
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /Perfil nuevo de acme\/nuevo/);
  assert.match(r.stderr, /checks\.typecheck +pnpm typecheck/);
  assert.equal(r.stdout, "✓ Fijado el perfil de acme/nuevo · versión 1\n");
  const show = await cli("repo", "profile", repo);
  assert.equal(show.code, 0, show.stderr);
  assert.match(show.stdout, /^acme\/nuevo {2}perfil · versión 1 · ahora\n/);
  assert.match(show.stdout, /install +pnpm install --frozen-lockfile/);
  assert.match(show.stdout, /checks\.lint +pnpm lint/);
  assert.match(show.stdout, /docs +docs\/\*\*, \*\*\/\*\.md/);
  assert.match(show.stdout, /protectedPaths +—/);
  const json = await shown(repo);
  assert.deepEqual(json.profile, PROFILE);
  assert.equal(json.repo, "acme/nuevo");
  assert.equal(json.version, 1);
});

test("--set sobre un perfil enseña solo lo que cambia; con --json, stdout es la respuesta", async () => {
  const repo = await register("cambio");
  await cli("repo", "profile", repo, "--set", file(PROFILE), "--yes");
  const next = { ...PROFILE, checks: { ...PROFILE.checks, lint: null }, docs: ["docs/**"] };
  const r = await cli("repo", "profile", repo, "--set", file(next), "--yes", "--json");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).profile, next);
  assert.equal(JSON.parse(r.stdout).version, 2);
  const human = await cli("repo", "profile", repo, "--set", file(PROFILE), "--yes");
  assert.match(human.stderr, /Cambios en el perfil de acme\/cambio \(versión 2\)/);
  assert.match(human.stderr, /checks\.lint +— → pnpm lint/);
  assert.match(human.stderr, /docs +docs\/\*\* → docs\/\*\*, \*\*\/\*\.md/);
  assert.doesNotMatch(human.stderr, /install/);
});

test("--set con el mismo perfil no escribe nada", async () => {
  const repo = await register("igual");
  await cli("repo", "profile", repo, "--set", file(PROFILE), "--yes");
  const r = await cli("repo", "profile", repo, "--set", file(PROFILE), "--yes");
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /El perfil de acme\/igual ya es ese\. No se ha cambiado nada\./);
  assert.equal((await shown(repo)).version, 1);
});

test("sin --yes fuera de una terminal sale con 2 y no cambia nada", async () => {
  const repo = await register("sinyes");
  const r = await cli("repo", "profile", repo, "--set", file(PROFILE));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Fijar el perfil de acme\/sinyes necesita confirmación/);
  assert.match(r.stderr, /--yes/);
  assert.equal((await cli("repo", "profile", repo)).code, 7);
});

test("un fichero que no existe, que no es JSON o que no es un perfil sale con 2", async () => {
  const repo = await register("malo");
  const bad = { ...PROFILE, checks: { ...PROFILE.checks, test: "pnpm test && rm -rf ." } };
  const cases: [string, RegExp][] = [
    [join(root, "no-existe.json"), /No se puede leer .*no-existe\.json\./],
    [file("{ no es json"), /no es JSON válido\./],
    [file(bad), /El perfil de .* no es válido: checks\.test: un comando exacto/],
    [file({ ...PROFILE, extra: 1 }), /El perfil de .* no es válido: .*extra/],
  ];
  for (const [path, text] of cases) {
    const r = await cli("repo", "profile", repo, "--set", path, "--yes");
    assert.equal(r.code, 2, path);
    assert.match(r.stderr, text, path);
  }
  assert.equal((await cli("repo", "profile", repo)).code, 7);
});

test("un campo desconocido con caracteres de control no mueve la terminal", async () => {
  const repo = await register("control");
  const path = file({ ...PROFILE, "\u001b[31mrojo\u0007": 1 });
  const r = await cli("repo", "profile", repo, "--set", path, "--yes");
  assert.equal(r.code, 2);
  assert.equal(r.stderr.includes("\u001b") || r.stderr.includes("\u0007"), false);
});

test("al confirmar se fija; al cancelar no se cambia nada", async () => {
  const repo = await register("pregunta");
  const questions: string[] = [];
  const no = await setRepoProfile(home, repo, PROFILE, {
    confirm: async (q) => {
      questions.push(q);
      return false;
    },
    show: () => {},
  });
  assert.equal(no, null);
  assert.match(questions[0] ?? "", /¿Fijar este perfil en acme\/pregunta\? \[s\/N\]/);
  assert.equal((await cli("repo", "profile", repo)).code, 7);
  const yes = await setRepoProfile(home, repo, PROFILE, {
    confirm: async () => true,
    show: () => {},
  });
  assert.equal(yes?.changed, true);
  assert.equal(yes?.view.version, 1);
});

test("errores de uso: sale con 2", async () => {
  for (const args of [["profile"], ["profile", "../x"], ["profile", "acme/a", "otro"]]) {
    assert.equal((await cli("repo", ...args)).code, 2, args.join(" "));
  }
});

test("la ayuda de profile y la general lo listan", async () => {
  const help = await cli("repo", "profile", "--help");
  assert.match(help.stdout, /togi repo profile <owner\/repo> \[--set <fichero\.json>\]/);
  const general = await cli("--help");
  assert.match(general.stdout, /togi repo profile/);
});
