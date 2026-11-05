import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { runCli } from "./testing/run-cli.ts";

const SECRET = "sk-ant-SENTINEL-9f3a7c1d2b";
const TOKEN = "oauth-SENTINEL-0123456789";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
before(async () => {
  root = mkdtempSync(join(tmpdir(), "togi-auth-"));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
});
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

const auth = (input: string | undefined, ...args: string[]) =>
  runCli(["auth", ...args, "--no-color"], home, {}, input);
const everything = (r: { stdout: string; stderr: string }) => `${r.stdout}\n${r.stderr}`;

test("set-api-key por tubería guarda, no muestra el secreto y status da el modo", async () => {
  const set = await auth(`${SECRET}\n`, "set-api-key");
  assert.equal(set.code, 0, set.stderr);
  assert.match(set.stdout, /Clave de API guardada/);
  assert.ok(!everything(set).includes(SECRET));
  const status = await auth(undefined, "status");
  assert.equal(status.stdout, "✓ Modo activo: clave de API\n");
  assert.deepEqual(JSON.parse((await auth(undefined, "status", "--json")).stdout), {
    mode: "api-key",
  });
});

test("use-subscription sustituye a la clave de API", async () => {
  await auth(`${SECRET}\n`, "set-api-key");
  const set = await auth(`${TOKEN}\n`, "use-subscription", "--json");
  assert.equal(set.code, 0, set.stderr);
  assert.deepEqual(JSON.parse(set.stdout), { mode: "subscription" });
  const status = await auth(undefined, "status");
  assert.equal(status.stdout, "✓ Modo activo: suscripción\n");
  assert.ok(!everything(status).includes(TOKEN) && !everything(status).includes(SECRET));
});

test("nunca acepta el secreto como argumento ni lo repite en el error", async () => {
  for (const args of [
    ["set-api-key", SECRET],
    ["use-subscription", TOKEN],
    ["set-api-key", `--key=${SECRET}`],
    ["set-api-key", "--key", SECRET],
    [SECRET],
    ["status", SECRET],
  ]) {
    const r = await auth("", ...args);
    assert.equal(r.code, 2, args.join(" "));
    assert.ok(!everything(r).includes(SECRET) && !everything(r).includes(TOKEN), args.join(" "));
  }
});

test("nunca lo lee del entorno", async () => {
  const empty = await runCli(
    ["auth", "set-api-key"],
    home,
    {
      ANTHROPIC_API_KEY: "sk-ant-ENV-0123456789",
      TOGI_API_KEY: "sk-ant-ENV-0123456789",
    },
    "",
  );
  assert.equal(empty.code, 2);
  assert.ok(!everything(empty).includes("ENV-0123456789"));
});

test("entrada vacía o con caracteres no válidos: error sin eco y nada cambia", async () => {
  const before = (await auth(undefined, "status")).stdout;
  assert.equal((await auth("\n", "set-api-key")).code, 2);
  const bad = await auth(`${SECRET} con espacio\n`, "set-api-key");
  assert.equal(bad.code, 2);
  assert.ok(!everything(bad).includes(SECRET));
  assert.equal((await auth(undefined, "status")).stdout, before);
});

test("sin daemon falla antes de leer el secreto", async () => {
  const r = await runCli(["auth", "set-api-key"], join(root, "sin-daemon"), {}, `${SECRET}\n`);
  assert.equal(r.code, 6);
  assert.ok(!everything(r).includes(SECRET));
});

test("las dos entradas a la vez: status sale con 4 y no elige modo", async () => {
  writeFileSync(join(home, "togi-agent-api-key.secret"), SECRET);
  writeFileSync(join(home, "togi-agent-subscription-token.secret"), TOKEN);
  const r = await auth(undefined, "status");
  assert.equal(r.code, 4);
  assert.match(r.stderr, /dos modos/);
  assert.deepEqual(JSON.parse((await auth(undefined, "status", "--json")).stdout), {
    mode: "inconsistent",
  });
});

test("el secreto solo está en el almacén: ni en la base de datos, ni en los blobs ni en el log", async () => {
  await auth(`${SECRET}\n`, "set-api-key");
  const scan = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return scan(p);
      return e.isFile() && !p.endsWith(".secret") ? [readFileSync(p, "latin1")] : [];
    });
  assert.ok(!scan(home).join("\n").includes(SECRET));
});
