import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { listen } from "./listen.ts";

let dir: string;
let sock: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "togi-lis-"));
  sock = join(dir, "run", "t.sock");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ok = () => new Response("ok");

test("run/ se crea con 0700 y un socket viejo sin proceso se reemplaza", async () => {
  mkdirSync(join(dir, "run"));
  const stale = createServer().listen(sock);
  await new Promise((r) => stale.once("listening", r));
  stale.close();
  // close() borra el fichero; se recrea un socket huérfano con un proceso hijo muerto
  const { spawnSync } = await import("node:child_process");
  spawnSync(process.execPath, [
    "-e",
    `require("net").createServer().listen(${JSON.stringify(sock)});process.kill(process.pid,"SIGKILL")`,
  ]);
  const server = await listen(ok, sock);
  assert.equal(statSync(join(dir, "run")).mode & 0o777, 0o700);
  await server.close();
});

test("si el socket está en uso por otro proceso, aborta", async () => {
  const first = await listen(ok, sock);
  await assert.rejects(listen(ok, sock), /en uso/);
  await first.close();
});

test("si la ruta existe y no es un socket, aborta sin borrarla", async () => {
  mkdirSync(join(dir, "run"));
  writeFileSync(sock, "datos");
  await assert.rejects(listen(ok, sock), /no es un socket/);
  assert.equal(statSync(sock).size, 5);
});

test("escucha en un socket Unix y no abre ningún puerto TCP", async () => {
  const { spawnSync } = await import("node:child_process");
  const server = await listen(ok, sock);
  const lsof = spawnSync(
    "lsof",
    ["-nP", "-a", "-p", String(process.pid), "-iTCP", "-sTCP:LISTEN"],
    { encoding: "utf8" },
  );
  if (lsof.error === undefined) assert.equal(lsof.stdout.trim(), "");
  assert.equal(statSync(sock).isSocket(), true);
  await server.close();
});
