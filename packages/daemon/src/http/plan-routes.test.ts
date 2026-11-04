import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "./app.ts";
import { taskRoutes } from "./tasks.ts";
import { planFixture } from "./testing/plan-fixture.ts";

let f: Awaited<ReturnType<typeof planFixture>>;
beforeEach(async () => {
  f = await planFixture();
});
afterEach(() => f.close());

const IF = (v: number) => ({ "if-match": `"${v}"` });
const REASON = { reason: { category: "scope", text: "demasiado grande" } };
const state = () =>
  (f.db.prepare("SELECT state FROM tasks WHERE number = 1").get() as { state: string }).state;
const version = () => f.store.currentVersion("task:1");
const code = async (res: Response) => ((await res.json()) as { code: string }).code;

test("approve lleva la tarea a building y registra la decisión sobre el último plan", async () => {
  await f.plan();
  const res = await f.send("POST", "/v1/tasks/1/plan/approve", undefined, IF(version()));
  assert.equal(res.status, 200);
  assert.equal(state(), "building");
  const d = f.db.prepare("SELECT verdict, plan_version FROM decisions").get();
  assert.deepEqual({ ...(d as object) }, { verdict: "approve", plan_version: 1 });
});

test("request-changes vuelve a planning y reject lleva a rejected, con el motivo como blob", async () => {
  await f.plan();
  const changes = await f.send("POST", "/v1/tasks/1/plan/request-changes", REASON, IF(version()));
  assert.equal(changes.status, 200);
  assert.equal(state(), "planning");
  await f.plan("v2");
  const reject = await f.send("POST", "/v1/tasks/1/plan/reject", REASON, IF(version()));
  assert.equal(reject.status, 200);
  assert.equal(state(), "rejected");
  const rows = f.db.prepare("SELECT plan_version, reason FROM decisions ORDER BY seq").all();
  assert.deepEqual(
    rows.map((r) => (r as { plan_version: number }).plan_version),
    [1, 2],
  );
  assert.doesNotMatch(JSON.stringify(rows), /demasiado grande/);
});

test("sin If-Match 428, con una versión vieja 412, y no se escribe nada", async () => {
  await f.plan();
  const before = version();
  assert.equal((await f.send("POST", "/v1/tasks/1/plan/approve")).status, 428);
  const old = await f.send("POST", "/v1/tasks/1/plan/approve", undefined, IF(before - 1));
  assert.equal(old.status, 412);
  assert.equal(version(), before);
});

test("un plan nuevo entre la lectura y la decisión invalida el If-Match", async () => {
  await f.plan();
  const seen = version();
  await f.send("POST", "/v1/tasks/1/plan/request-changes", REASON, IF(seen));
  await f.plan("v2");
  assert.equal((await f.send("POST", "/v1/tasks/1/plan/approve", undefined, IF(seen))).status, 412);
});

test("motivo ausente 400, vacío 400 y categoría inválida 400", async () => {
  await f.plan();
  for (const body of [
    {},
    { reason: { category: "scope", text: "" } },
    { reason: { category: "x", text: "a" } },
  ]) {
    for (const route of ["request-changes", "reject"]) {
      const res = await f.send("POST", `/v1/tasks/1/plan/${route}`, body, IF(version()));
      assert.equal(res.status, 400);
    }
  }
});

test("decidir fuera de plan_review da 422 invalid_state", async () => {
  const res = await f.send("POST", "/v1/tasks/1/plan/approve", undefined, IF(version()));
  assert.equal(res.status, 422);
  assert.equal(await code(res), "invalid_state");
});

test("un plan que pasa de los límites no se aprueba: 422 plan_exceeds_limits", async () => {
  await f.plan("grande", 300);
  const res = await f.send("POST", "/v1/tasks/1/plan/approve", undefined, IF(version()));
  assert.equal(res.status, 422);
  assert.equal(await code(res), "plan_exceeds_limits");
  assert.equal(state(), "plan_review");
});

test("tarea inexistente 404 y sin token 401", async () => {
  assert.equal((await f.send("POST", "/v1/tasks/9/plan/approve", undefined, IF(1))).status, 404);
  const res = await f.app.request("/v1/tasks/1/plan/approve", { method: "POST" });
  assert.equal(res.status, 401);
});

test("un actor que no es humano no puede decidir: 422 actor_not_allowed y nada escrito", async () => {
  await f.plan();
  const agent = new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("actor", { kind: "agent", sessionId: "ses_1", role: "planner" });
      c.set("requestId", "r");
      await next();
    })
    .route("/", taskRoutes(f.db, f.handle));
  const before = version();
  for (const [route, body] of [
    ["approve", undefined],
    ["request-changes", REASON],
    ["reject", REASON],
  ] as const) {
    const res = await agent.request(`/v1/tasks/1/plan/${route}`, {
      method: "POST",
      headers: { "if-match": `"${before}"`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(res.status, 422);
    assert.equal(await code(res), "actor_not_allowed");
  }
  assert.equal(version(), before);
});
