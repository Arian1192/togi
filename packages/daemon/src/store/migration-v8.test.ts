import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { NewEvent } from "@togi/core";
import Database from "better-sqlite3";
import { hashToken } from "../auth/tokens.ts";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { paths } from "../config/app.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { openEventDatabase } from "./database.ts";
import { SqliteEventStore } from "./event-store.ts";
import { MIGRATIONS, SCHEMA_V1_SQL, SCHEMA_VERSION } from "./schema.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "togi-mig8-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const actor = { kind: "human", userId: "usr_1" } as const;
let clock = 0;
const ev = (type: string, payload: unknown): NewEvent => ({
  type,
  schemaVersion: 1,
  actor,
  at: `2026-11-03T10:00:${String(clock++).padStart(2, "0")}Z`,
  payload,
});

/** Una base en versión 7 con tres tareas: sin criterio, con criterio y con el criterio vaciado. */
async function seedV7() {
  const path = paths(home).database;
  const old = new Database(path);
  old.exec(SCHEMA_V1_SQL);
  for (let v = 2; v <= 7; v++) old.exec(MIGRATIONS[v] as string);
  old.pragma("user_version = 7");
  old.prepare("INSERT INTO users VALUES ('usr_1', 'owner', 'now')").run();
  old.prepare("INSERT INTO tokens VALUES (?, 'usr_1', 'now')").run(hashToken("tok"));
  const keychain = selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } });
  const blobs = new FileBlobStore(
    paths(home).blobs,
    new DataKeyring(old, await loadOrCreateMasterKey(keychain)),
  );
  const put = (text: string, n: number) => blobs.put(Buffer.from(text), "task_text", n);
  const store = new SqliteEventStore(old);
  const created = async (n: number, criteria: string | null) =>
    ev("task.created", {
      title: await put(`Tarea ${n}`, n),
      description: null,
      acceptanceCriteria: criteria === null ? null : await put(criteria, n),
      risk: "low",
      repo: "o/r",
      baseBranch: "dev",
      source: { kind: "cli" },
    });
  await store.append("task:1", 0, [await created(1, null)]);
  await store.append("task:2", 0, [await created(2, "criterio")]);
  await store.append("task:3", 0, [
    await created(3, "criterio"),
    ev("task.edited", { acceptanceCriteria: null }),
  ]);
  old.close();
  return path;
}

test("una base en versión 7 con eventos migra y la proyección queda llena con has_criteria correcto", async () => {
  const path = await seedV7();
  const db = openEventDatabase(path);
  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  const rows = db
    .prepare("SELECT number, repo, base_branch, has_criteria FROM tasks ORDER BY number")
    .all();
  assert.deepEqual(rows, [
    { number: 1, repo: "o/r", base_branch: "dev", has_criteria: 0 },
    { number: 2, repo: "o/r", base_branch: "dev", has_criteria: 1 },
    { number: 3, repo: "o/r", base_branch: "dev", has_criteria: 0 },
  ]);
  db.close();
});

test("si la reconstrucción falla, el error del arranque lleva el seq y el motivo y la base no cambia", async () => {
  const path = await seedV7();
  const old = new Database(path);
  // Un evento que ya no se puede interpretar, tras los tres primeros.
  await new SqliteEventStore(old).append("task:4", 0, [ev("task.created", { title: "roto" })]);
  old.close();
  assert.throws(
    () => openEventDatabase(path),
    (error: Error) => /reconstruir la proyección tasks: evento seq 5: /.test(error.message),
  );
  const raw = new Database(path);
  assert.equal(raw.pragma("user_version", { simple: true }), 7);
  raw.close();
});
