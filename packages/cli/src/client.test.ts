import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { paths } from "@togi/daemon/config";
import { createClient } from "./client.ts";
import type { CliError } from "./errors.ts";

function fakeHome(): string {
  const home = join(mkdtempSync(join(tmpdir(), "togi-client-")), "home");
  mkdirSync(paths(home).runDir, { recursive: true });
  return home;
}

test("un id de respuesta inválido se sustituye por el enviado", async () => {
  const home = fakeHome();
  writeFileSync(paths(home).credentials, "tok\n");
  const server = createServer((_req, res) => {
    res.writeHead(401, { "content-type": "application/problem+json", "x-request-id": "a b" });
    res.end(JSON.stringify({ code: "unauthorized" }));
  });
  await new Promise<void>((ok) => server.listen(paths(home).socket, ok));
  try {
    const client = createClient(home);
    const error = await client.checked(await client.api.v1.health.$get()).catch((e: CliError) => e);
    assert.equal((error as CliError).context.requestId, client.requestId);
  } finally {
    server.close();
    rmSync(join(home, ".."), { recursive: true, force: true });
  }
});

test("un id de respuesta válido es el que se muestra", async () => {
  const home = fakeHome();
  writeFileSync(paths(home).credentials, "tok\n");
  const server = createServer((_req, res) => {
    res.writeHead(401, { "content-type": "application/problem+json", "x-request-id": "7f3a9c" });
    res.end(JSON.stringify({ code: "unauthorized" }));
  });
  await new Promise<void>((ok) => server.listen(paths(home).socket, ok));
  try {
    const client = createClient(home);
    const error = await client.checked(await client.api.v1.health.$get()).catch((e: CliError) => e);
    assert.equal((error as CliError).context.requestId, "7f3a9c");
  } finally {
    server.close();
    rmSync(join(home, ".."), { recursive: true, force: true });
  }
});

test("sin credenciales ni socket es «sin daemon» (6)", () => {
  const home = fakeHome();
  try {
    assert.throws(
      () => createClient(home),
      (e: CliError) => e.exitCode === 6,
    );
  } finally {
    rmSync(join(home, ".."), { recursive: true, force: true });
  }
});
