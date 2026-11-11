import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { StoredEvent } from "@togi/core";
import type Database from "better-sqlite3";
import { hashToken } from "../auth/tokens.ts";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { createApp } from "./app.ts";
import type { ReadDeps } from "./queries.ts";

let dir: string;
let db: Database.Database;
let store: SqliteEventStore;
let app: ReturnType<typeof createApp>;
let notified: StoredEvent[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "togi-repo-profile-api-"));
  db = openEventDatabase(join(dir, "togi.db"));
  db.prepare("INSERT INTO users VALUES (?, ?, ?)").run("usr_1", "owner", "now");
  db.prepare("INSERT INTO tokens VALUES (?, ?, ?)").run(hashToken("tok"), "usr_1", "now");
  db.prepare("INSERT INTO repos VALUES (?, ?, ?)").run("Arian1192/promos", "/x/promos", "now");
  store = new SqliteEventStore(db);
  notified = [];
  store.subscribe((event) => notified.push(event));
  // Estas rutas solo usan el store: el resto de dependencias de lectura no se tocan.
  app = createApp(db, undefined, { store } as unknown as ReadDeps);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const profile = {
  install: "pnpm install --frozen-lockfile",
  checks: { typecheck: "pnpm typecheck", lint: null, test: "pnpm test" },
  testFiles: ["apps/**/*.test.ts"],
  protectedPaths: [],
  docs: ["docs/**"],
  registry: ["registry.npmjs.org"],
  testExclude: [],
};

const send = (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { authorization: "Bearer tok", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
const PATH = "/v1/repos/Arian1192/promos/profile";
const code = async (res: Response) => ((await res.json()) as { code: string }).code;
const profileEvents = () =>
  db.prepare("SELECT stream, stream_version FROM events WHERE type = 'repo.profile_set'").all();

test("fijar el perfil lo guarda en el log y lo devuelve, con la misma forma que el GET", async () => {
  const put = await send("PUT", PATH, profile);
  assert.equal(put.status, 200);
  const body = (await put.json()) as Record<string, unknown>;
  assert.deepEqual(
    { ...body, setAt: undefined },
    { repo: "Arian1192/promos", profile, version: 1, setAt: undefined },
  );
  const got = await send("GET", PATH);
  assert.equal(got.status, 200);
  assert.deepEqual(await got.json(), body);
  assert.deepEqual(profileEvents(), [{ stream: "repo:arian1192/promos", stream_version: 1 }]);
  assert.equal(notified.length, 1);
  const actor = JSON.parse(
    (db.prepare("SELECT actor FROM events").get() as { actor: string }).actor,
  );
  assert.deepEqual(actor, { kind: "human", userId: "usr_1" });
});

test("el mismo perfil no añade eventos; otro distinto sube la versión", async () => {
  await send("PUT", PATH, profile);
  const same = await send("PUT", "/v1/repos/arian1192/PROMOS/profile", profile);
  assert.equal(same.status, 200);
  assert.equal(((await same.json()) as { version: number }).version, 1);
  assert.equal(profileEvents().length, 1);

  const changed = { ...profile, checks: { ...profile.checks, lint: "pnpm lint" } };
  const next = await send("PUT", PATH, changed);
  assert.equal(next.status, 200);
  const body = (await next.json()) as { version: number; profile: unknown; repo: string };
  assert.equal(body.version, 2);
  assert.deepEqual(body.profile, changed);
  assert.equal(body.repo, "Arian1192/promos");
});

test("repo sin registrar, sin perfil o con nombre inválido: 404 con su código", async () => {
  const cases: [string, string, string][] = [
    ["GET", "/v1/repos/acme/otro/profile", "repo_not_found"],
    ["PUT", "/v1/repos/acme/otro/profile", "repo_not_found"],
    ["GET", "/v1/repos/..x/promos/profile", "repo_not_found"],
    ["GET", PATH, "repo_profile_not_found"],
  ];
  for (const [method, path, expected] of cases) {
    const res = await send(method, path, method === "PUT" ? profile : undefined);
    assert.equal(res.status, 404, `${method} ${path}`);
    assert.equal(await code(res), expected);
  }
  assert.equal(profileEvents().length, 0);
});

test("un cuerpo inválido responde 400 y no escribe nada", async () => {
  const cases: [unknown, string][] = [
    ["{no es json", "invalid_json"],
    [{ ...profile, checks: { ...profile.checks, test: null } }, "validation_error"],
    [{ ...profile, install: "pnpm i && rm -rf /" }, "validation_error"],
    [{ ...profile, extra: 1 }, "validation_error"],
  ];
  for (const [body, expected] of cases) {
    const res = await send("PUT", PATH, body);
    assert.equal(res.status, 400, expected);
    assert.equal(await code(res), expected);
  }
  assert.equal(profileEvents().length, 0);
});

test("sin token, 401; sin store, el PUT responde 503 y el GET sigue leyendo", async () => {
  assert.equal((await app.request(PATH)).status, 401);
  await send("PUT", PATH, profile);
  app = createApp(db);
  const put = await send("PUT", PATH, profile);
  assert.equal(put.status, 503);
  assert.equal(await code(put), "not_configured");
  assert.equal((await send("GET", PATH)).status, 200);
});
