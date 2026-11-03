import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hashToken } from "../auth/tokens.ts";
import { paths } from "../config/app.ts";
import { startDaemon } from "../start.ts";
import { openEventDatabase } from "../store/database.ts";
import { socketClient } from "../testing/socket-client.ts";
import { createApp } from "./app.ts";

test("sin handle, los comandos responden 503 not_configured", async () => {
  const home = mkdtempSync(join(tmpdir(), "togi-503-"));
  const db = openEventDatabase(paths(home).database);
  try {
    db.prepare("INSERT INTO users VALUES (?, ?, ?)").run("usr_1", "owner", "now");
    db.prepare("INSERT INTO tokens VALUES (?, ?, ?)").run(hashToken("tok"), "usr_1", "now");
    const headers = { authorization: "Bearer tok", "if-match": "1" };
    const app = createApp(db);
    for (const [method, path] of [
      ["POST", "/v1/tasks"],
      ["PATCH", "/v1/tasks/1"],
      ["POST", "/v1/tasks/1/submit"],
      ["POST", "/v1/tasks/1/reject"],
    ] as const) {
      const res = await app.request(path, { method, headers, body: "{}" });
      assert.equal(res.status, 503, path);
      assert.equal(((await res.json()) as { code: string }).code, "not_configured");
    }
  } finally {
    db.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("el daemon arrancado con startDaemon no responde 503 en ninguna ruta", async () => {
  const dir = mkdtempSync(join(tmpdir(), "togi-no503-"));
  const home = join(dir, "home");
  const daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
  try {
    const call = socketClient(home);
    const reject = { reason: { category: "scope", text: "x" } };
    const statuses = [
      (await call("POST", "/v1/tasks", { title: "Filtro", risk: "low", repo: "o/r" })).status,
      (await call("PATCH", "/v1/tasks/1", { title: "Otro" }, { "if-match": "1" })).status,
      (await call("POST", "/v1/tasks/1/submit", undefined, { "if-match": "2" })).status,
      (await call("POST", "/v1/tasks/1/reject", reject, { "if-match": "2" })).status,
      (await call("GET", "/v1/health")).status,
    ];
    assert.ok(
      statuses.every((s) => s !== 503),
      statuses.join(),
    );
  } finally {
    await daemon.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
