import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { createClient } from "./client.ts";
import { runCli } from "./testing/run-cli.ts";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
before(async () => {
  root = mkdtempSync(join(tmpdir(), "togi-status-"));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
});
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

const create = async (title: string, ...extra: string[]): Promise<string> => {
  const r = await runCli(
    ["task", "new", title, "--risk", "low", "--repo", "o/r", ...extra, "--json"],
    home,
  );
  assert.equal(r.code, 0, r.stderr);
  return String(JSON.parse(r.stdout).number);
};
/** `task submit`/`reject` aún no existen en la CLI: se mueve el estado con la API del daemon. */
const api = (n: string) => {
  const client = createClient(home).api.v1.tasks[":n"];
  const param = { param: { n } };
  return {
    submit: async () => {
      const r = await client.submit.$post(param, { headers: { "if-match": "1" } });
      assert.equal(r.status, 200);
    },
    reject: async () => {
      const r = await client.reject.$post(param, {
        headers: { "if-match": "1", "content-type": "application/json" },
        init: { body: JSON.stringify({ reason: { category: "other", text: "no" } }) },
      });
      assert.equal(r.status, 200);
    },
  };
};
const status = (...args: string[]) => runCli(["status", ...args, "--no-color"], home);

test("sin tareas, una línea", async () => {
  const r = await status();
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "No hay tareas.\n");
});

test("agrupa por estado, oculta las rechazadas y las cuenta; --all las muestra", async () => {
  const a = await create("Sin criterio");
  const b = await create("Con criterio", "--criteria", "ok");
  await api(b).submit();
  const c = await create("Rechazada", "--criteria", "ok");
  await api(c).reject();

  const out = (await status()).stdout;
  assert.match(
    out,
    new RegExp(`^Pendiente de ti\\n {2}#${a} {2}Sin criterio +draft +bajo +falta criterio\\n`),
  );
  assert.match(
    out,
    new RegExp(`\\nEn curso\\n {2}#${b} {2}Con criterio +planning +bajo +ahora\\n`),
  );
  assert.match(out, /\n2 tareas · 1 rechazada oculta \(togi status --all\)\n$/);
  assert.ok(!out.includes("Rechazada"), out);

  const all = (await status("--all")).stdout;
  assert.match(all, new RegExp(`\\nCerradas\\n {2}#${c} {2}Rechazada +rejected `));
  assert.match(all, /\n3 tareas\n$/);
});

test("--state filtra; un estado inválido sale con 2", async () => {
  const only = (await status("--state", "draft")).stdout;
  assert.match(only, /Pendiente de ti/);
  assert.ok(!only.includes("En curso"), only);
  const none = await status("--state", "building");
  assert.equal(none.stdout, "No hay tareas en estado building.\n");
  const bad = await status("--state", "nope");
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--state/);
  assert.equal((await status("sobra")).code, 2);
});

test("--json imprime la respuesta de la API sin filtrar", async () => {
  const r = await runCli(["status", "--json"], home);
  const body = JSON.parse(r.stdout);
  assert.ok(Array.isArray(body.tasks));
  assert.ok(body.tasks.some((t: { state: string }) => t.state === "rejected"));
  assert.ok(body.tasks.every((t: { titleErased: boolean }) => t.titleErased === false));
});

test("status --help trae el uso", async () => {
  const r = await runCli(["status", "--help"], home);
  assert.match(r.stdout, /Uso: togi status \[--state <estado>\] \[--all\]/);
});
