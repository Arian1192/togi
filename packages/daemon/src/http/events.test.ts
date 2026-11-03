import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type Database from "better-sqlite3";
import { hashToken } from "../auth/tokens.ts";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { createHandler } from "../commands/handle-command.ts";
import { paths } from "../config/app.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { openEventDatabase } from "../store/database.ts";
import { SqliteEventStore } from "../store/event-store.ts";
import { createApp } from "./app.ts";

const TOKEN = "tok-de-prueba";
const AUTH = { authorization: `Bearer ${TOKEN}` };
let home: string;
let db: Database.Database;
let store: SqliteEventStore;
let make: (heartbeatMs?: number) => ReturnType<typeof createApp>;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "togi-sse-"));
  const p = paths(home);
  db = openEventDatabase(p.database);
  db.prepare("INSERT INTO users VALUES (?, ?, ?)").run("usr_1", "owner", "now");
  db.prepare("INSERT INTO tokens VALUES (?, ?, ?)").run(hashToken(TOKEN), "usr_1", "now");
  const keychain = selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } });
  const keys = new DataKeyring(db, await loadOrCreateMasterKey(keychain));
  store = new SqliteEventStore(db);
  const blobs = new FileBlobStore(p.blobs, keys);
  make = (heartbeatMs) =>
    createApp(db, createHandler({ db, store, blobs }), {
      store,
      blobs,
      ...(heartbeatMs === undefined ? {} : { heartbeatMs }),
    });
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

const create = (app: ReturnType<typeof make>, title = "Filtro") =>
  app.request("/v1/tasks", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({ title, risk: "low", repo: "o/r" }),
  });

const open = async (app: ReturnType<typeof make>, headers: Record<string, string> = {}) => {
  const res = await app.request("/v1/events", { headers: { ...AUTH, ...headers } });
  assert.equal(res.status, 200);
  assert.ok(res.body);
  return res.body.getReader();
};

/** Lee hasta que `done(texto)` se cumple o el stream se cierra. */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  done: (text: string) => boolean,
): Promise<{ text: string; closed: boolean }> {
  const decoder = new TextDecoder();
  let text = "";
  const timeout = setTimeout(() => void reader.cancel(), 2000);
  try {
    while (!done(text)) {
      const chunk = await reader.read();
      if (chunk.done) return { text, closed: true };
      text += decoder.decode(chunk.value, { stream: true });
    }
    return { text, closed: false };
  } finally {
    clearTimeout(timeout);
  }
}

const ids = (text: string) => [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
const count = (n: number) => (text: string) => ids(text).length >= n;
const subscribed = async (n = 1) => {
  for (let i = 0; i < 200 && store.subscriberCount() < n; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(store.subscriberCount(), n);
};

test("emite el historial desde el principio y desde un Last-Event-ID", async () => {
  const app = make();
  await create(app, "Uno");
  await create(app, "Dos");
  const all = await open(app);
  const { text } = await readUntil(all, count(2));
  assert.deepEqual(ids(text), [1, 2]);
  assert.match(text, /^event: task\.created$/m);
  assert.match(text, /^data: \{.*"seq":1.*\}$/m);
  await all.cancel();

  const resumed = await open(app, { "last-event-id": "1" });
  assert.deepEqual(ids((await readUntil(resumed, count(1))).text), [2]);
  await resumed.cancel();
});

test("un evento escrito tras conectarse llega en directo", async () => {
  const app = make();
  const reader = await open(app);
  await subscribed();
  await create(app);
  assert.deepEqual(ids((await readUntil(reader, count(1))).text), [1]);
  await reader.cancel();
});

test("carrera: un append a mitad del historial llega exactamente una vez", async () => {
  const app = make();
  await create(app, "Uno");
  await create(app, "Dos");
  const original = store.readAll.bind(store);
  store.readAll = (from) => {
    return (async function* () {
      let injected = false;
      for await (const e of original(from)) {
        yield e;
        if (!injected) {
          injected = true;
          await create(app, "Tres");
        }
      }
    })();
  };
  const reader = await open(app);
  await readUntil(reader, count(3));
  // Un cuarto evento actúa de testigo: un duplicado del 3 aparecería antes que él.
  await create(app, "Cuatro");
  const { text } = await readUntil(reader, (t) => t.includes("Cuatro"));
  assert.deepEqual(ids(text), [4]);
  await reader.cancel();
});

test("un append que falla y se deshace no llega al stream", async () => {
  const app = make();
  await create(app, "Uno");
  const reader = await open(app);
  await readUntil(reader, count(1));
  await subscribed();
  assert.throws(() =>
    store.appendWithin(
      "task:9",
      0,
      [
        {
          type: "task.created",
          schemaVersion: 1,
          actor: { kind: "human", userId: "usr_1" },
          at: new Date().toISOString(),
          payload: { marker: "revocable" },
        },
      ],
      () => {
        throw new Error("falla");
      },
    ),
  );
  await create(app, "Dos");
  const { text } = await readUntil(reader, count(1));
  assert.deepEqual(ids(text), [2]);
  assert.ok(!text.includes("revocable"));
  await reader.cancel();
});

test("tras reader.cancel() no queda ningún suscriptor", async () => {
  const reader = await open(make());
  await subscribed();
  await reader.cancel();
  for (let i = 0; i < 200 && store.subscriberCount() > 0; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(store.subscriberCount(), 0);
});

test("sin token, 401; Last-Event-ID inválido, 400; sin reads, 503", async () => {
  const app = make();
  assert.equal((await app.request("/v1/events")).status, 401);
  for (const bad of ["abc", "-1", "1.5", ""]) {
    const res = await app.request("/v1/events", { headers: { ...AUTH, "last-event-id": bad } });
    assert.equal(res.status, 400, bad);
  }
  const res = await createApp(db).request("/v1/events", { headers: AUTH });
  assert.equal(res.status, 503);
});

test("un evento corrupto envía event: error con su seq y cierra el stream", async () => {
  const app = make();
  await create(app);
  db.exec("DROP TRIGGER events_no_update");
  db.prepare("UPDATE events SET payload = '{}' WHERE stream = 'task:1'").run();
  const reader = await open(app);
  const { text, closed } = await readUntil(reader, () => false);
  assert.ok(closed);
  assert.match(text, /^event: error$/m);
  assert.match(text, /^data: \{"code":"integrity_error","seq":1\}$/m);
  assert.equal(store.subscriberCount(), 0);
});

test("latido: aparece ': ping' con heartbeatMs pequeño", async () => {
  const reader = await open(make(20));
  const { text } = await readUntil(reader, (t) => t.includes(": ping"));
  assert.match(text, /^: ping$/m);
  await reader.cancel();
});
