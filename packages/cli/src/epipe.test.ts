import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { runCli } from "./testing/run-cli.ts";
import { spawnCli } from "./testing/spawn-cli.ts";

let root: string;
let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
before(async () => {
  root = mkdtempSync(join(tmpdir(), "togi-epipe-"));
  home = join(root, "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
});
after(async () => {
  await daemon.close();
  rmSync(root, { recursive: true, force: true });
});

const newTask = (title: string) =>
  runCli(["task", "new", title, "--risk", "low", "--repo", "o/r"], home);
const timeout = <T>(p: Promise<T>, ms: number): Promise<T | "timeout"> =>
  Promise.race([p, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms))]);

test("togi watch con la salida cerrada (| head) termina en silencio con 0, sin EPIPE ni traza", async () => {
  await newTask("Antes");
  const w = spawnCli(["watch", "--from-start"], home);
  // Espera a la primera línea y cierra el lado de lectura, como haría `head -1`.
  while (!w.stdout().includes("\n")) await new Promise((resolve) => setTimeout(resolve, 20));
  w.child.stdout?.destroy();
  // El siguiente evento obliga a escribir en una tubería rota.
  await newTask("Despues");
  const code = await timeout(w.exit, 5000);
  if (code === "timeout") w.child.kill();
  assert.equal(code, 0, w.stderr());
  assert.equal(w.stderr(), "", "nada en stderr: ni EPIPE ni traza");
});

test("sin tubería rota, un comando normal sigue saliendo con su código y su salida", async () => {
  const r = await runCli(["daemon", "status"], home);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Daemon en marcha/);
});
