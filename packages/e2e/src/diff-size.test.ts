import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";

const TOOL = join(import.meta.dirname, "..", "..", "..", "tools", "diff-size.mjs");

let repo: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", repo, ...args], {
    stdio: "pipe",
  });
const lines = (n: number, tag = "x") =>
  `${Array.from({ length: n }, (_, i) => `${tag}${i}`).join("\n")}\n`;
function write(path: string, text: string) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}
const measure = () => {
  const r = spawnSync(process.execPath, [TOOL], { cwd: repo, encoding: "utf8" });
  const n = (label: string) => Number(new RegExp(`^${label}\\s+(\\d+)`, "m").exec(r.stdout)?.[1]);
  return {
    code: r.status,
    prod: n("Producción"),
    tests: n("Tests"),
    docs: n("Docs"),
    stdout: r.stdout,
  };
};

before(() => {
  repo = mkdtempSync(join(tmpdir(), "togi-diff-size-"));
  git("init", "-q", "-b", "main");
  write("src/base.ts", lines(5, "base"));
  git("add", ".");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "rama");
});
after(() => rmSync(repo, { recursive: true, force: true }));

test("sin nada preparado mide cero, aunque haya cambios sin preparar, y avisa de ellos", () => {
  write("src/base.ts", lines(40, "otro")); // modificado, sin preparar
  write("src/nuevo.ts", lines(30)); // nuevo, sin preparar
  const m = measure();
  assert.deepEqual([m.prod, m.tests, m.docs, m.code], [0, 0, 0, 0]);
  assert.match(m.stdout, /Aviso: 2 fichero\(s\) sin preparar no cuentan; usa git add/);
});

test("solo cuenta lo preparado, y lo demás sigue avisando", () => {
  git("add", "src/nuevo.ts");
  const m = measure();
  assert.equal(m.prod, 30);
  assert.match(m.stdout, /Aviso: 1 fichero\(s\) sin preparar/);
});

test("separa producción, tests y docs de lo preparado", () => {
  write("src/a.test.ts", lines(7, "t"));
  write("docs/guia.md", lines(4, "d"));
  git("add", "src/a.test.ts", "docs/guia.md");
  const m = measure();
  assert.deepEqual([m.prod, m.tests, m.docs], [30, 7, 4]);
});

test("lo ya commiteado en la rama sigue contando, y el aviso desaparece sin pendientes", () => {
  git("checkout", "--", "src/base.ts"); // descarta lo modificado sin preparar
  git("commit", "-q", "-m", "uno");
  const m = measure();
  assert.deepEqual([m.prod, m.tests, m.docs], [30, 7, 4]);
  assert.doesNotMatch(m.stdout, /Aviso/);
});

test("un cambio posterior preparado se suma a lo commiteado", () => {
  write("src/mas.ts", lines(10, "m"));
  git("add", "src/mas.ts");
  assert.equal(measure().prod, 40);
});

test("pasarse de los límites sale con 1, y dentro del margen avisa sin fallar", () => {
  write("src/margen.ts", lines(175, "g")); // 40 + 175 = 215: sobre 200, bajo 220
  git("add", "src/margen.ts");
  const margen = measure();
  assert.equal(margen.prod, 215);
  assert.equal(margen.code, 0);
  assert.match(margen.stdout, /Dentro del margen del 10%/);
  write("src/grande.ts", lines(50, "h"));
  git("add", "src/grande.ts");
  const excede = measure();
  assert.equal(excede.code, 1);
  assert.match(excede.stdout, /Pasa del límite/);
});
