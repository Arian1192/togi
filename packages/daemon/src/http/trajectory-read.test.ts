import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { erase } from "../blobs/erase.ts";
import { RedactingBlobStore } from "../blobs/redacting-blob-store.ts";
import { AgentEventStore } from "../trajectory/agent-event-store.ts";
import { planFixture } from "./testing/plan-fixture.ts";

let f: Awaited<ReturnType<typeof planFixture>>;
let events: AgentEventStore;
beforeEach(async () => {
  f = await planFixture();
  events = new AgentEventStore(f.db, new RedactingBlobStore(f.blobs));
  await f.plan();
});
afterEach(() => f.close());

type Page = {
  events: { seq: number; at: string; kind: string; content: unknown; contentErased: boolean }[];
  nextAfter: number;
  hasMore: boolean;
  sessionState: string;
};

const URL = "/v1/tasks/1/sessions/ses_1/trajectory";
const fill = async (n: number) => {
  for (let i = 1; i <= n; i++) await events.append("ses_1", 1, "message", { n: i });
};
const page = async (query = ""): Promise<Page> => {
  const res = await f.send("GET", `${URL}${query}`);
  assert.equal(res.status, 200);
  return (await res.json()) as Page;
};

test("devuelve los eventos en orden de seq con su tipo y contenido, sin hashes", async () => {
  await events.append("ses_1", 1, "tool_call", { tool: "Bash", command: "ls" });
  await events.append("ses_1", 1, "message", "hola");
  const body = await page();
  assert.deepEqual(
    body.events.map((e) => [e.seq, e.kind, e.content, e.contentErased]),
    [
      [1, "tool_call", { tool: "Bash", command: "ls" }, false],
      [2, "message", "hola", false],
    ],
  );
  assert.equal(body.sessionState, "ended");
  assert.doesNotMatch(JSON.stringify(body), /hash|payload|keyId/i);
});

test("el contenido sale como dato JSON, sin interpretarlo", async () => {
  await events.append("ses_1", 1, "message", "<script>alert(1)</script>");
  await events.append("ses_1", 1, "usage", { in: 3, nested: [1, null] });
  const body = await page();
  assert.equal(body.events[0]?.content, "<script>alert(1)</script>");
  assert.deepEqual(body.events[1]?.content, { in: 3, nested: [1, null] });
});

test("un secreto escrito en la trayectoria sale limpio", async () => {
  const secret = `sk-ant-api03-${"A1b2C3d4".repeat(6)}`;
  await events.append("ses_1", 1, "tool_result", { out: secret });
  const res = await f.send("GET", URL);
  const text = await res.text();
  assert.ok(!text.includes(secret));
  assert.match(text, /REDACTED/);
});

test("una clave borrada sale como [borrado] con su indicador", async () => {
  await events.append("ses_1", 1, "message", "secreto");
  const deps = { events: f.store, keys: f.keys, blobs: f.blobs };
  await erase(deps, 1, "trajectory", "RGPD", { kind: "human", userId: "usr_1" });
  const body = await page();
  assert.equal(body.events[0]?.content, "[borrado]");
  assert.equal(body.events[0]?.contentErased, true);
});

test("un blob manipulado da 500 integrity_error", async () => {
  await fill(1);
  const row = f.db.prepare("SELECT payload FROM agent_events").get() as { payload: string };
  const ref = { ...JSON.parse(row.payload), hash: `hmac-sha256:${"0".repeat(64)}` };
  f.db.exec("DROP TRIGGER agent_events_no_update");
  f.db.prepare("UPDATE agent_events SET payload = ?").run(JSON.stringify(ref));
  const res = await f.send("GET", URL);
  assert.equal(res.status, 500);
  assert.equal(((await res.json()) as { code: string }).code, "integrity_error");
});

test("404: tarea inexistente, sesión inexistente y sesión de otra tarea", async () => {
  await f.handle(
    { kind: "human", userId: "usr_1" },
    {
      type: "create",
      title: "Otra",
      description: "",
      acceptanceCriteria: "c",
      risk: "low",
      repo: "o/r",
      baseBranch: "main",
      source: { kind: "cli" },
    },
  );
  const missingTask = await f.send("GET", "/v1/tasks/9/sessions/ses_1/trajectory");
  assert.equal(missingTask.status, 404);
  assert.equal(((await missingTask.json()) as { code: string }).code, "task_not_found");
  for (const path of [
    "/v1/tasks/2/sessions/ses_1/trajectory",
    "/v1/tasks/1/sessions/nada/trajectory",
  ]) {
    const res = await f.send("GET", path);
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { code: string }).code, "session_not_found");
  }
});

test("sin token da 401", async () => {
  assert.equal((await f.app.request(URL)).status, 401);
});

test("limit parte la trayectoria y hasMore es falso en la última página", async () => {
  await fill(5);
  const first = await page("?limit=2");
  assert.deepEqual(
    first.events.map((e) => e.seq),
    [1, 2],
  );
  assert.equal(first.hasMore, true);
  assert.equal(first.nextAfter, 2);
  const last = await page("?after=4&limit=2");
  assert.deepEqual(
    last.events.map((e) => e.seq),
    [5],
  );
  assert.equal(last.hasMore, false);
  assert.equal(last.nextAfter, 5);
});

test("after recorre toda la trayectoria sin duplicados ni huecos", async () => {
  await fill(7);
  const seen: number[] = [];
  let after = 0;
  for (let guard = 0; guard < 10; guard++) {
    const body = await page(`?after=${after}&limit=3`);
    seen.push(...body.events.map((e) => e.seq));
    after = body.nextAfter;
    if (!body.hasMore) break;
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7]);
});

test("por defecto son 50 eventos y el máximo 200", async () => {
  await fill(51);
  const body = await page();
  assert.equal(body.events.length, 50);
  assert.equal(body.hasMore, true);
  assert.equal((await f.send("GET", `${URL}?limit=200`)).status, 200);
});

test("parámetros fuera de rango dan 400 validation_error", async () => {
  for (const q of ["limit=0", "limit=201", "limit=x", "after=-1", "after=abc", "after=1.5"]) {
    const res = await f.send("GET", `${URL}?${q}`);
    assert.equal(res.status, 400, q);
    assert.equal(((await res.json()) as { code: string }).code, "validation_error");
  }
});

test("seguir en directo: un evento nuevo aparece con el mismo nextAfter; vacía repite el cursor", async () => {
  await fill(2);
  const first = await page();
  const idle = await page(`?after=${first.nextAfter}`);
  assert.deepEqual(idle.events, []);
  assert.equal(idle.nextAfter, first.nextAfter);
  assert.equal(idle.hasMore, false);
  await events.append("ses_1", 1, "message", { n: 3 });
  const next = await page(`?after=${first.nextAfter}`);
  assert.deepEqual(
    next.events.map((e) => e.seq),
    [3],
  );
});
