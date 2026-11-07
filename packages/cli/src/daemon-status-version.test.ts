import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { paths } from "@togi/daemon/config";
import { versionText } from "./release-notice.ts";
import { runCli } from "./testing/run-cli.ts";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

test("versionText: etiqueta y commit corto si el daemon es una instalación", () => {
  assert.equal(
    versionText({ daemon: "0.0.0", release: "v0.2.0", commit: COMMIT }),
    "v0.2.0 (0123456)",
  );
});

test("versionText: sin commit solo la etiqueta; desde el repo o un daemon viejo, el package.json", () => {
  assert.equal(versionText({ daemon: "0.0.0", release: "v0.2.0" }), "v0.2.0");
  assert.equal(versionText({ daemon: "0.0.0", release: "dev" }), "0.0.0");
  assert.equal(versionText({ daemon: "0.0.0" }), "0.0.0");
});

test("versionText: lo que cuenta el daemon no lleva caracteres de control a la terminal", () => {
  const text = versionText({ daemon: "0.0.0", release: "v1\u001b[2J", commit: "ab\u0007cdef0123" });
  // biome-ignore lint/suspicious/noControlCharactersInRegex: justo lo que se comprueba
  assert.doesNotMatch(text, /[\u0000-\u001f\u007f]/);
});

/** Un daemon falso que contesta lo que `togi daemon status` pregunta. */
async function statusWith(health: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "togi-ver-"));
  const home = join(root, "home");
  const p = paths(home);
  mkdirSync(p.runDir, { recursive: true });
  writeFileSync(p.credentials, "tok\n");
  const body: Record<string, unknown> = {
    "/v1/health": { schema: 11, pid: 4242, lastSeq: 0, ...health },
    "/v1/planner": { state: "active", reason: "" },
    "/v1/notifications": { state: "active", reason: "" },
  };
  const server = createServer((req, res) => {
    const found = body[req.url ?? ""];
    res.writeHead(found === undefined ? 404 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(found ?? {}));
  });
  await new Promise<void>((ok) => server.listen(p.socket, ok));
  try {
    return await runCli(["daemon", "status", "--no-color"], home);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test("daemon status muestra la etiqueta y el commit corto, no la versión del package.json", async () => {
  const r = await statusWith({ daemon: "0.0.0", release: "v0.2.0", commit: COMMIT });
  assert.match(r.stdout, /Daemon en marcha · versión v0\.2\.0 \(0123456\) · pid 4242 · /);
  assert.doesNotMatch(r.stdout, /0\.0\.0/);
});

test("daemon status de un daemon que corre desde el repo sigue mostrando el package.json", async () => {
  const r = await statusWith({ daemon: "0.0.0", release: "dev" });
  assert.match(r.stdout, /Daemon en marcha · versión 0\.0\.0 · pid 4242 · /);
});

test("daemon status de un daemon viejo sin release sigue como estaba", async () => {
  const r = await statusWith({ daemon: "0.0.0" });
  assert.match(r.stdout, /Daemon en marcha · versión 0\.0\.0 · pid 4242 · /);
});
