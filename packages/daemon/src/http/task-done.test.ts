import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { Hono } from "hono";
import { rebuildTasks } from "../projections/tasks.ts";
import type { AppEnv } from "./app.ts";
import { taskRoutes } from "./tasks.ts";
import { planFixture } from "./testing/plan-fixture.ts";

let f: Awaited<ReturnType<typeof planFixture>>;
beforeEach(async () => {
  f = await planFixture();
});
afterEach(() => f.close());

const IF = (v: number) => ({ "if-match": `"${v}"` });
const version = () => f.store.currentVersion("task:1");
const row = () =>
  f.db.prepare("SELECT state, stream_version FROM tasks WHERE number = 1").get() as {
    state: string;
    stream_version: number;
  };
const problemOf = async (res: Response) =>
  (await res.json()) as { code: string; state?: string; status: number };

/** La tarea 1 con su plan aprobado: en building. */
async function building() {
  await f.plan();
  const res = await f.send("POST", "/v1/tasks/1/plan/approve", undefined, IF(version()));
  assert.equal(res.status, 200);
  assert.equal(row().state, "building");
}

test("done con If-Match y prNumber válido: 200, merged y task.completed en el log con actor y PR", async () => {
  await building();
  const res = await f.send("POST", "/v1/tasks/1/done", { prNumber: 125 }, IF(version()));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { state: string }).state, "merged");
  const event = f.db
    .prepare("SELECT actor, payload, schema_version FROM events WHERE type = 'task.completed'")
    .get() as { actor: string; payload: string; schema_version: number };
  assert.deepEqual(JSON.parse(event.payload), { prNumber: 125 });
  assert.deepEqual(JSON.parse(event.actor), { kind: "human", userId: "usr_1" });
  assert.equal(event.schema_version, 1);
});

test("desde otro estado: 422 invalid_state con el estado actual en el problema", async () => {
  await f.plan();
  const res = await f.send("POST", "/v1/tasks/1/done", { prNumber: 125 }, IF(version()));
  assert.equal(res.status, 422);
  const body = await problemOf(res);
  assert.equal(body.code, "invalid_state");
  assert.equal(body.state, "plan_review");
  assert.equal(row().state, "plan_review");
});

test("un token de agente recibe 422 actor_not_allowed (como el resto de errores de dominio) y la tarea sigue en building", async () => {
  await building();
  const agent = new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("actor", { kind: "agent", sessionId: "ses_1", role: "planner" });
      c.set("requestId", "r");
      await next();
    })
    .route("/", taskRoutes(f.db, f.handle));
  const before = version();
  const res = await agent.request("/v1/tasks/1/done", {
    method: "POST",
    headers: { "if-match": `"${before}"`, "content-type": "application/json" },
    body: JSON.stringify({ prNumber: 125 }),
  });
  assert.equal(res.status, 422);
  assert.equal((await problemOf(res)).code, "actor_not_allowed");
  assert.equal(row().state, "building");
  assert.equal(version(), before, "no se escribió nada");
});

test("un prNumber ausente, no entero, menor que 1 o no numérico: 400 validation_error", async () => {
  await building();
  const before = version();
  for (const body of [
    {},
    { prNumber: 0 },
    { prNumber: -3 },
    { prNumber: 1.5 },
    { prNumber: "12" },
  ]) {
    const res = await f.send("POST", "/v1/tasks/1/done", body, IF(before));
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal((await problemOf(res)).code, "validation_error");
  }
  assert.equal(row().state, "building");
  assert.equal(version(), before);
});

test("sin If-Match 428, con una versión vieja 412, y no se escribe nada", async () => {
  await building();
  const before = version();
  assert.equal((await f.send("POST", "/v1/tasks/1/done", { prNumber: 125 })).status, 428);
  const old = await f.send("POST", "/v1/tasks/1/done", { prNumber: 125 }, IF(before - 1));
  assert.equal(old.status, 412);
  assert.equal(version(), before);
});

test("tarea inexistente 404, sin token 401, y completar dos veces: la segunda es 422 task_final", async () => {
  await building();
  assert.equal((await f.send("POST", "/v1/tasks/9/done", { prNumber: 1 }, IF(1))).status, 404);
  const anon = await f.app.request("/v1/tasks/1/done", { method: "POST" });
  assert.equal(anon.status, 401);
  assert.equal(
    (await f.send("POST", "/v1/tasks/1/done", { prNumber: 125 }, IF(version()))).status,
    200,
  );
  const again = await f.send("POST", "/v1/tasks/1/done", { prNumber: 125 }, IF(version()));
  assert.equal(again.status, 422);
  assert.equal((await problemOf(again)).code, "task_final");
});

test("la proyección tasks queda en merged y se reconstruye igual con rebuildTasks", async () => {
  await building();
  await f.send("POST", "/v1/tasks/1/done", { prNumber: 125 }, IF(version()));
  const table = () => f.db.prepare("SELECT * FROM tasks ORDER BY number").all();
  const incremental = table();
  assert.equal(row().state, "merged");
  for (const batchSize of [1, 500]) {
    rebuildTasks(f.db, f.store, batchSize);
    assert.deepEqual(table(), incremental, `lote ${batchSize}`);
  }
});
