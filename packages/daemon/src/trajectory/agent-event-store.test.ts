import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { BlobRef } from "@togi/core";
import type Database from "better-sqlite3";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { RedactingBlobStore } from "../blobs/redacting-blob-store.ts";
import { paths } from "../config/app.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { AgentEventStore } from "./agent-event-store.ts";

const SECRET = ["sk-ant-", "api03-", "q".repeat(40)].join("");
const PEM = [
  "-----BEGIN OPENSSH ",
  "PRIVATE KEY-----\nAAAAB3NzaC1yc2E\n-----END OPENSSH PRIVATE KEY-----",
].join("");
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

let home: string;
let db: Database.Database;
let blobs: RedactingBlobStore;
let store: AgentEventStore;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-traj-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  const key = await loadOrCreateMasterKey(selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } }));
  blobs = new RedactingBlobStore(new FileBlobStore(p.blobs, new DataKeyring(db, key)));
  store = new AgentEventStore(db, blobs, () => new Date("2026-11-05T10:00:00.000Z"));
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

test("cada sesión tiene su cadena: seq desde 1 y génesis propio", async () => {
  const a1 = await store.append("ses_a", 1, "tool_call", { tool: "Read" });
  const b1 = await store.append("ses_b", 1, "message", { text: "hola" });
  const a2 = await store.append("ses_a", 1, "tool_result", { ok: true });
  assert.deepEqual([a1.seq, b1.seq, a2.seq], [1, 1, 2]);
  assert.equal(a1.prevHash, "0".repeat(64));
  assert.equal(b1.prevHash, "0".repeat(64));
  assert.equal(a2.prevHash, a1.hash);
  assert.equal(store.readSession("ses_a").length, 2);
  assert.deepEqual(store.verify(), { ok: true });
});

test("admite los cinco tipos, incluido denied, y rechaza otros", async () => {
  for (const kind of ["tool_call", "tool_result", "message", "denied", "usage"] as const) {
    await store.append("ses_a", 1, kind, { kind });
  }
  assert.deepEqual(
    store.readSession("ses_a").map((e) => e.kind),
    ["tool_call", "tool_result", "message", "denied", "usage"],
  );
  await assert.rejects(store.append("ses_a", 1, "otro" as never, {}), RangeError);
  assert.equal(store.readSession("ses_a").length, 5);
});

test("el payload es un blob trajectory y la fila solo guarda la referencia", async () => {
  const e = await store.append("ses_a", 7, "tool_call", { tool: "Bash", command: "ls" });
  const ref = JSON.parse(e.payload) as BlobRef;
  assert.equal(ref.dataClass, "trajectory");
  assert.deepEqual(JSON.parse(dec(await blobs.get(ref))), { tool: "Bash", command: "ls" });
  assert.ok(!e.payload.includes("Bash"));
});

test("los secretos del payload se limpian antes de guardarse y no llegan a disco", async () => {
  const e = await store.append("ses_a", 1, "tool_result", { out: `${SECRET}\n${PEM}` });
  const back = dec(await blobs.get(JSON.parse(e.payload) as BlobRef));
  assert.ok(
    back.includes("[REDACTED:anthropic-api-key]") && back.includes("[REDACTED:private-key]"),
  );
  assert.ok(!back.includes(SECRET) && !back.includes("AAAAB3NzaC1yc2E"));
  const scan = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((f) => {
      const p = join(dir, f.name);
      return f.isDirectory() ? scan(p) : statSync(p).size > 0 ? [readFileSync(p, "latin1")] : [];
    });
  assert.ok(!scan(home).join("\n").includes(SECRET));
});

test("los triggers impiden modificar o borrar", async () => {
  await store.append("ses_a", 1, "message", {});
  assert.throws(() => db.prepare("UPDATE agent_events SET kind = 'denied'").run(), /append-only/);
  assert.throws(() => db.prepare("DELETE FROM agent_events").run(), /append-only/);
});

test("una manipulación deliberada rompe la cadena de su sesión y nombra la sesión", async () => {
  await store.append("ses_a", 1, "message", { n: 1 });
  for (let i = 0; i < 3; i++) await store.append("ses_b", 1, "message", { n: i });
  db.exec("DROP TRIGGER agent_events_no_update");
  db.prepare(
    "UPDATE agent_events SET kind = 'denied' WHERE session_id = 'ses_b' AND seq = 2",
  ).run();
  assert.deepEqual(store.verify(), { ok: false, brokenAt: 2, session: "ses_b" });
});

test("borrar un evento de en medio se detecta", async () => {
  for (let i = 0; i < 3; i++) await store.append("ses_a", 1, "message", { n: i });
  db.exec("DROP TRIGGER agent_events_no_delete");
  db.prepare("DELETE FROM agent_events WHERE seq = 2").run();
  assert.deepEqual(store.verify(), { ok: false, brokenAt: 2, session: "ses_a" });
});

test("escrituras concurrentes a una sesión producen una cadena sin huecos", async () => {
  await Promise.all(Array.from({ length: 25 }, (_, i) => store.append("ses_a", 1, "usage", { i })));
  assert.deepEqual(
    store.readSession("ses_a").map((e) => e.seq),
    Array.from({ length: 25 }, (_, i) => i + 1),
  );
  assert.deepEqual(store.verify(), { ok: true });
});

/** Registra en el log de dominio que la sesión terminó con `n` eventos de trayectoria. */
async function ended(sessionId: string, n: number): Promise<void> {
  await new SqliteEventStore(db).append(`task:${sessionId}`, 0, [
    {
      type: "session.ended",
      schemaVersion: 1,
      actor: { kind: "system", component: "adapter:test" },
      at: "2026-11-05T10:00:00.000Z",
      payload: {
        sessionId,
        outcome: "completed",
        usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, durationMs: 0 },
        trajectoryEvents: n,
      },
    },
  ]);
}

test("una sesión terminada con el número de eventos que registró es íntegra", async () => {
  for (let i = 0; i < 3; i++) await store.append("ses_a", 1, "message", { i });
  await ended("ses_a", 3);
  assert.deepEqual(store.verify(), { ok: true });
});

test("una sesión sin session.ended no se cruza (aún puede estar en curso)", async () => {
  await store.append("ses_a", 1, "message", {});
  await ended("ses_b", 0);
  assert.deepEqual(store.verify(), { ok: true });
});

test("un final truncado se detecta: faltan eventos que el log de dominio contó", async () => {
  for (let i = 0; i < 4; i++) await store.append("ses_a", 1, "message", { i });
  await ended("ses_a", 4);
  db.exec("DROP TRIGGER agent_events_no_delete");
  db.prepare("DELETE FROM agent_events WHERE seq > 2").run();
  // La cadena que queda es íntegra; solo el cruce lo delata. Falta el evento 3.
  assert.deepEqual(store.verify(), { ok: false, brokenAt: 3, session: "ses_a" });
});

test("una sesión borrada entera se detecta", async () => {
  for (let i = 0; i < 2; i++) await store.append("ses_a", 1, "message", { i });
  await ended("ses_a", 2);
  db.exec("DROP TRIGGER agent_events_no_delete");
  db.prepare("DELETE FROM agent_events WHERE session_id = 'ses_a'").run();
  assert.deepEqual(store.verify(), { ok: false, brokenAt: 1, session: "ses_a" });
});

test("eventos añadidos después de session.ended también se detectan", async () => {
  for (let i = 0; i < 2; i++) await store.append("ses_a", 1, "message", { i });
  await ended("ses_a", 2);
  await store.append("ses_a", 1, "message", { tarde: true });
  assert.deepEqual(store.verify(), { ok: false, brokenAt: 3, session: "ses_a" });
});
