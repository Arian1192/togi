import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { paths } from "../config/app.ts";
import { openEventDatabase } from "../store/database.ts";
import { bootstrap } from "./bootstrap.ts";
import { hashToken } from "./tokens.ts";

const env = { TOGI_KEYCHAIN: "file" };
let home: string;
beforeEach(() => {
  home = join(mkdtempSync(join(tmpdir(), "togi-boot-")), "home");
});
afterEach(() => rmSync(join(home, ".."), { recursive: true, force: true }));

const rows = (db: import("better-sqlite3").Database, table: string) =>
  db.prepare(`SELECT * FROM ${table}`).all() as Record<string, string>[];

test("el primer arranque crea home 0700, credentials 0600 y solo guarda el hash", async () => {
  const { db, userId } = await bootstrap(home, env);
  const p = paths(home);
  assert.equal(statSync(home).mode & 0o777, 0o700);
  assert.equal(statSync(p.credentials).mode & 0o777, 0o600);
  const token = readFileSync(p.credentials, "utf8").trim();
  assert.match(userId, /^usr_[0-9a-f]{32}$/);
  assert.deepEqual(
    rows(db, "tokens").map((r) => r.token_hash),
    [hashToken(token)],
  );
  assert.ok(!JSON.stringify([rows(db, "users"), rows(db, "tokens")]).includes(token));
  db.close();
});

test("el segundo arranque no cambia usuario, token ni credentials", async () => {
  const first = await bootstrap(home, env);
  const creds = readFileSync(paths(home).credentials, "utf8");
  const snapshot = [rows(first.db, "users"), rows(first.db, "tokens")];
  first.db.close();
  const second = await bootstrap(home, env);
  assert.equal(second.userId, first.userId);
  assert.deepEqual([rows(second.db, "users"), rows(second.db, "tokens")], snapshot);
  assert.equal(readFileSync(paths(home).credentials, "utf8"), creds);
  second.db.close();
});

test("usuario sin credentials: revoca sus tokens y emite uno nuevo", async () => {
  const first = await bootstrap(home, env);
  const oldHash = rows(first.db, "tokens")[0]?.token_hash;
  first.db.close();
  rmSync(paths(home).credentials);
  const second = await bootstrap(home, env);
  const token = readFileSync(paths(home).credentials, "utf8").trim();
  assert.equal(second.userId, first.userId);
  assert.deepEqual(
    rows(second.db, "tokens").map((r) => r.token_hash),
    [hashToken(token)],
  );
  assert.notEqual(hashToken(token), oldHash);
  second.db.close();
});

test("credentials con un token desconocido: error y no se toca nada", async () => {
  const first = await bootstrap(home, env);
  first.db.close();
  writeFileSync(paths(home).credentials, "ajeno\n");
  await assert.rejects(bootstrap(home, env), /no corresponde/);
  assert.equal(readFileSync(paths(home).credentials, "utf8"), "ajeno\n");
});

test("un credentials escrito a mano antes del primer arranque no se vuelve válido", async () => {
  mkdirSync(home, { recursive: true });
  writeFileSync(paths(home).credentials, "manual\n");
  await assert.rejects(bootstrap(home, env), /no corresponde/);
  const db = openEventDatabase(paths(home).database);
  assert.equal(rows(db, "users").length, 0);
  assert.equal(rows(db, "tokens").length, 0);
  db.close();
});
