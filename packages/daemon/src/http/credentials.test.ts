import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type Database from "better-sqlite3";
import { hashToken } from "../auth/tokens.ts";
import { paths } from "../config/app.ts";
import { agentCredentials } from "../credentials/agent-credential.ts";
import { FileSecretStore } from "../keys/file-secret-store.ts";
import { startDaemon } from "../start.ts";
import { openEventDatabase } from "../store/database.ts";
import { socketClient } from "../testing/socket-client.ts";
import { createApp } from "./app.ts";

const SECRET = "sk-ant-SENTINEL-9f3a7c1d2b";
const URL = "/v1/agent-credential";

/** Recoge todo lo escrito por stdout/stderr y por console durante `fn`. */
async function capture(fn: () => Promise<void>): Promise<string> {
  const out: string[] = [];
  const writers = [process.stdout, process.stderr];
  const originals = writers.map((w) => w.write);
  for (const w of writers) {
    w.write = ((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    }) as typeof w.write;
  }
  try {
    await fn();
  } finally {
    writers.forEach((w, i) => {
      w.write = originals[i] as typeof w.write;
    });
  }
  return out.join("");
}

/** Contenido de todos los ficheros bajo `dir`, salvo los que guardan la credencial a propósito. */
function filesUnder(dir: string, skip: (p: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return filesUnder(p, skip);
    return e.isFile() && !skip(p) && statSync(p).size > 0 ? [readFileSync(p, "latin1")] : [];
  });
}

async function withDaemon(
  fn: (home: string, call: ReturnType<typeof socketClient>, db: Database.Database) => Promise<void>,
) {
  const home = join(mkdtempSync(join(tmpdir(), "togi-cred-")), "home");
  const daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
  try {
    await fn(home, socketClient(home), daemon.db);
  } finally {
    await daemon.close();
  }
}

test("PUT guarda, GET informa el modo y el secreto no aparece en ninguna parte", async () => {
  await withDaemon(async (home, call, db) => {
    let wire = "";
    const logged = await capture(async () => {
      const bodies = [
        await call("PUT", URL, { mode: "api-key", secret: SECRET }),
        await call("GET", URL),
        await call("PUT", URL, { mode: "api-key", secret: `${SECRET}"bad` }),
        await call("PUT", URL, { mode: "otro", secret: SECRET }),
        await call("PUT", URL, { secret: SECRET, extra: SECRET }),
      ];
      assert.deepEqual(
        bodies.map((b) => b.status),
        [200, 200, 400, 400, 400],
      );
      assert.deepEqual(bodies[0]?.json, { mode: "api-key" });
      assert.deepEqual(bodies[1]?.json, { mode: "api-key" });
      wire = JSON.stringify(bodies);
    });
    assert.ok(!wire.includes(SECRET), "respuestas");
    assert.ok(!logged.includes(SECRET), "salida del proceso");
    assert.deepEqual(db.prepare("SELECT seq FROM events").all(), [], "no se escribe ningún evento");
    // Base de datos, blobs y log del daemon: el único fichero con el secreto es el del almacén de tests.
    const stored = (p: string) => p.endsWith(".secret");
    const others = filesUnder(home, stored).join("\n");
    assert.ok(!others.includes(SECRET), "disco");
  });
});

test("cambiar de modo sustituye la credencial anterior", async () => {
  await withDaemon(async (_home, call) => {
    await call("PUT", URL, { mode: "api-key", secret: SECRET });
    await call("PUT", URL, { mode: "subscription", secret: "oauth-token-0123456789" });
    assert.deepEqual((await call("GET", URL)).json, { mode: "subscription" });
  });
});

test("rechaza Idempotency-Key y no guarda nada", async () => {
  await withDaemon(async (home, call) => {
    const res = await call(
      "PUT",
      URL,
      { mode: "api-key", secret: SECRET },
      { "idempotency-key": "k-1" },
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.code, "idempotency_key_not_allowed");
    assert.deepEqual((await call("GET", URL)).json, { mode: null });
    const db = readFileSync(paths(home).database).toString("latin1");
    assert.ok(!db.includes(SECRET) && !db.includes("k-1"));
  });
});

test("no hay ninguna ruta que devuelva el secreto", async () => {
  const home = mkdtempSync(join(tmpdir(), "togi-cred-routes-"));
  const db = openEventDatabase(paths(home).database);
  try {
    db.prepare("INSERT INTO users VALUES (?, ?, ?)").run("usr_1", "owner", "now");
    db.prepare("INSERT INTO tokens VALUES (?, ?, ?)").run(hashToken("tok"), "usr_1", "now");
    const app = createApp(
      db,
      undefined,
      undefined,
      home,
      agentCredentials(new FileSecretStore(home)),
    );
    const headers = { authorization: "Bearer tok", "content-type": "application/json" };
    await app.request(URL, {
      method: "PUT",
      headers,
      body: JSON.stringify({ mode: "api-key", secret: SECRET }),
    });
    for (const method of ["GET", "POST", "DELETE", "PATCH", "PUT"]) {
      for (const path of [
        URL,
        `${URL}/secret`,
        `${URL}/api-key`,
        `${URL}/value`,
        "/v1/agent-credentials",
      ]) {
        const res = await app.request(path, {
          method,
          headers,
          ...(method === "GET" ? {} : { body: "{}" }),
        });
        const text = await res.text();
        assert.ok(
          !text.includes(SECRET) && !JSON.stringify([...res.headers]).includes(SECRET),
          `${method} ${path}`,
        );
      }
    }
  } finally {
    db.close();
  }
});
