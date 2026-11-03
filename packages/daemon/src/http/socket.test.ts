import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { paths } from "../config/app.ts";
import { startDaemon } from "../start.ts";
import { SCHEMA_VERSION } from "../store/schema.ts";

let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
beforeEach(async () => {
  home = join(mkdtempSync(join(tmpdir(), "togi-sock-")), "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
});
afterEach(async () => {
  await daemon.close();
  rmSync(join(home, ".."), { recursive: true, force: true });
});

function get(authorization?: string): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: paths(home).socket,
        path: "/v1/health",
        headers: authorization ? { authorization } : {},
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"]), body }),
        );
      },
    );
    req.on("error", reject).end();
  });
}

const token = () => readFileSync(paths(home).credentials, "utf8").trim();

test("el arranque deja run/ en 0700 y el socket en 0600", () => {
  assert.equal(statSync(paths(home).runDir).mode & 0o777, 0o700);
  assert.equal(statSync(paths(home).socket).mode & 0o777, 0o600);
});

test("sin token, con token inválido o con otro esquema: 401 problem+json", async () => {
  for (const header of [undefined, "Bearer nope", `Basic ${token()}`, token()]) {
    const res = await get(header);
    assert.equal(res.status, 401);
    assert.equal(res.type, "application/problem+json");
    assert.equal(JSON.parse(res.body).status, 401);
  }
});

test("con el token correcto, health responde 200 por el socket real", async () => {
  const res = await get(`Bearer ${token()}`);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).schema, SCHEMA_VERSION);
  assert.equal(typeof JSON.parse(res.body).daemon, "string");
});
