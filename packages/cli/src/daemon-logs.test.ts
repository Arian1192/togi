import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { paths } from "@togi/daemon/config";
import { cleanLogText, followLog, tailLog } from "./daemon-logs.ts";
import { runCli } from "./testing/run-cli.ts";
import { spawnCli } from "./testing/spawn-cli.ts";

// biome-ignore lint/suspicious/noControlCharactersInRegex: es justo lo que se comprueba
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

let root: string;
let home: string;
let log: string;
before(() => {
  root = mkdtempSync(join(tmpdir(), "togi-daemon-logs-"));
  home = join(root, "home");
  log = paths(home).log;
  mkdirSync(paths(home).runDir, { recursive: true });
});
after(() => rmSync(root, { recursive: true, force: true }));

const numbered = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => `línea ${from + i}`).join("\n");
const set = (text: string) => writeFileSync(log, text);

test("cleanLogText quita escapes de color, título y cursor, retornos de carro y C1, y deja \\n y \\t", () => {
  const dirty =
    "a\u001b[31mrojo\u001b[0m b\u001b]0;título\u0007 c\r\nd\u009b2J\u007f\te\u001b[?25l";
  assert.equal(cleanLogText(dirty), "arojo b c\nd\te");
  assert.ok(!CONTROL.test(cleanLogText(dirty).replace(/\n/g, "")));
});

test("tailLog devuelve las últimas N líneas, sin la línea vacía final", () => {
  set(`${numbered(10)}\n`);
  assert.deepEqual(tailLog(log, 3).lines, ["línea 8", "línea 9", "línea 10"]);
  assert.deepEqual(tailLog(log, 100).lines.length, 10);
});

test("con un log grande solo lee el final y descarta la primera línea, que llega cortada", () => {
  set(`${numbered(20_000)}\n`); // ~200 KB, más que lo que se lee
  const { lines } = tailLog(log, 5000);
  assert.equal(lines.at(-1), "línea 20000");
  assert.match(lines[0] ?? "", /^línea \d+$/, "la primera línea está entera");
  assert.ok(lines.length < 20_000);
});

test("las líneas salen limpias y las muy largas se cortan", () => {
  set(`a\u001b[31m rojo \u001b[0m\n${"x".repeat(5000)}\n`);
  const { lines } = tailLog(log, 2);
  assert.equal(lines[0], "a rojo ");
  assert.equal(lines[1]?.length, 2001);
  assert.ok(lines[1]?.endsWith("…"));
});

test("un log vacío no da líneas", () => {
  set("");
  assert.deepEqual(tailLog(log, 5), { lines: [], size: 0 });
});

test("followLog entrega las líneas nuevas, junta las partidas y para al abortar", async () => {
  set("vieja\n");
  const { size } = tailLog(log, 10);
  const got: string[] = [];
  const abort = new AbortController();
  const following = followLog(log, size, (l) => void got.push(l), abort.signal, 10);
  const until = async (n: number) => {
    for (let i = 0; i < 200 && got.length < n; i++) await new Promise((r) => setTimeout(r, 10));
  };
  appendFileSync(log, "nueva 1\nnueva \u001b[31m2\u001b[0m\npart");
  await until(2);
  assert.deepEqual(got, ["nueva 1", "nueva 2"], "la línea incompleta espera");
  appendFileSync(log, "ida\n");
  await until(3);
  assert.deepEqual(got.at(-1), "partida");
  abort.abort();
  await following;
});

test("followLog vuelve a empezar si el log se vacía o se sustituye", async () => {
  set(`${numbered(30)}\n`);
  const { size } = tailLog(log, 1);
  const got: string[] = [];
  const abort = new AbortController();
  const following = followLog(log, size, (l) => void got.push(l), abort.signal, 10);
  truncateSync(log, 0);
  appendFileSync(log, "tras vaciar\n");
  for (let i = 0; i < 200 && got.length < 1; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(got, ["tras vaciar"]);
  abort.abort();
  await following;
});

test("togi daemon logs muestra por defecto las últimas 50 líneas, y -n las que pidas", async () => {
  set(`${numbered(120)}\n`);
  const all = await runCli(["daemon", "logs"], home);
  assert.equal(all.code, 0, all.stderr);
  const lines = all.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 50);
  assert.deepEqual([lines[0], lines.at(-1)], ["línea 71", "línea 120"]);
  const few = await runCli(["daemon", "logs", "-n", "3"], home);
  assert.equal(few.stdout, "línea 118\nlínea 119\nlínea 120\n");
  const long = await runCli(["daemon", "logs", "--lines", "2"], home);
  assert.equal(long.stdout, "línea 119\nlínea 120\n");
});

test("lo que muestra no lleva escapes ni caracteres de control", async () => {
  set("ok\u001b[31m rojo\u001b[0m\u001b]0;titulo\u0007\r\nfin\u009b2J\n");
  const r = await runCli(["daemon", "logs"], home);
  assert.equal(r.stdout, "ok rojo\nfin\n");
});

test("--json escribe {lines}", async () => {
  set("uno\ndos\n");
  const r = await runCli(["daemon", "logs", "--json", "-n", "1"], home);
  assert.deepEqual(JSON.parse(r.stdout), { lines: ["dos"] });
});

test("un -n inválido, o --json con -f, salen con 2", async () => {
  set("uno\n");
  for (const n of ["0", "-1", "abc", "1.5", "1001", ""]) {
    const r = await runCli(["daemon", "logs", `--lines=${n}`], home);
    assert.equal(r.code, 2, n);
    assert.match(r.stderr, /El valor de -n no es válido: un número entre 1 y 1000/);
  }
  const both = await runCli(["daemon", "logs", "--json", "-f"], home);
  assert.equal(both.code, 2);
  assert.match(both.stderr, /--json no es válido: no se combina con -f/);
});

test("sin log todavía, error 7 con cómo arrancar el daemon", async () => {
  const r = await runCli(["daemon", "logs", "--no-color"], join(root, "otro-home"));
  assert.equal(r.code, 7);
  assert.match(r.stderr, /Todavía no hay log del daemon/);
  assert.match(r.stderr, /Arráncalo con: togi daemon start/);
});

test("-f muestra el final y luego lo que se escribe, y sale con 0 al interrumpirlo", async () => {
  set("antes 1\nantes 2\n");
  const w = spawnCli(["daemon", "logs", "-f", "-n", "1"], home);
  for (let i = 0; i < 200 && !w.stdout().includes("antes 2"); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(w.stdout(), "antes 2\n");
  appendFileSync(log, "después \u001b[31mnueva\u001b[0m\n");
  for (let i = 0; i < 200 && !w.stdout().includes("después"); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(w.stdout(), "antes 2\ndespués nueva\n");
  w.child.kill("SIGINT");
  assert.equal(await w.exit, 0, w.stderr());
});
