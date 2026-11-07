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
function add(path: string, n: number) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), lines(n));
  git("add", path);
}
const measure = () => {
  const r = spawnSync(process.execPath, [TOOL], { cwd: repo, encoding: "utf8" });
  const n = (label: string) => Number(new RegExp(`^${label}\\s+(\\d+)`, "m").exec(r.stdout)?.[1]);
  return { prod: n("Producción"), tests: n("Tests"), stdout: r.stdout };
};

before(() => {
  repo = mkdtempSync(join(tmpdir(), "togi-diff-size-rust-"));
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "base.txt"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "rama");
});
after(() => rmSync(repo, { recursive: true, force: true }));

test("Cargo.lock no cuenta, en la raíz ni en un paquete, y se informa como lockfile", () => {
  add("Cargo.lock", 300);
  add("packages/desktop/src-tauri/Cargo.lock", 400);
  const m = measure();
  assert.equal(m.prod, 0);
  assert.match(m.stdout, /sin contar 700 líneas del lockfile/);
});

test("un fichero que solo se parece a Cargo.lock sí cuenta como producción", () => {
  add("src/MiCargo.lock", 6);
  assert.equal(measure().prod, 6);
});

test("los ficheros de src-tauri/tests cuentan como tests y el resto de src-tauri como producción", () => {
  add("packages/desktop/src-tauri/tests/token-boundary.rs", 9);
  add("packages/desktop/src-tauri/src/daemon.rs", 5);
  const m = measure();
  assert.equal(m.tests, 9);
  assert.equal(m.prod, 11);
});
