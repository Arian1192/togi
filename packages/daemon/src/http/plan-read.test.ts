import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { erase } from "../blobs/erase.ts";
import { planFixture } from "./testing/plan-fixture.ts";

let f: Awaited<ReturnType<typeof planFixture>>;
beforeEach(async () => {
  f = await planFixture();
});
afterEach(() => f.close());

type PlanBody = {
  planVersion: number;
  approach: string;
  approachErased: boolean;
  baseSha: string;
  estimatedLines: { production: number; tests: number };
  previous: Record<string, unknown>[];
};

test("GET /plan devuelve el último plan con el enfoque y el ETag de la tarea", async () => {
  await f.plan("primer enfoque");
  const res = await f.send("GET", "/v1/tasks/1/plan");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("etag"), `"${f.store.currentVersion("task:1")}"`);
  const body = (await res.json()) as PlanBody;
  assert.equal(body.planVersion, 1);
  assert.equal(body.approach, "primer enfoque");
  assert.equal(body.approachErased, false);
  assert.equal(body.baseSha, "abc123");
  assert.deepEqual(body.estimatedLines, { production: 10, tests: 20 });
  assert.deepEqual(body.previous, []);
});

test("las versiones anteriores salen sin el enfoque", async () => {
  await f.plan("primer enfoque");
  const reason = { reason: { category: "scope", text: "más pequeño" } };
  const v = f.store.currentVersion("task:1");
  await f.send("POST", "/v1/tasks/1/plan/request-changes", reason, { "if-match": `"${v}"` });
  await f.plan("segundo enfoque");
  const body = (await (await f.send("GET", "/v1/tasks/1/plan")).json()) as PlanBody;
  assert.equal(body.planVersion, 2);
  assert.equal(body.approach, "segundo enfoque");
  assert.equal(body.previous.length, 1);
  assert.equal(body.previous[0]?.planVersion, 1);
  assert.doesNotMatch(JSON.stringify(body.previous), /primer enfoque|approach/);
});

test("un enfoque cuya clave se borró sale como [borrado] con su indicador", async () => {
  await f.plan("enfoque secreto");
  const deps = { events: f.store, keys: f.keys, blobs: f.blobs };
  await erase(deps, 1, "task_text", "RGPD", { kind: "human", userId: "usr_1" });
  const res = await f.send("GET", "/v1/tasks/1/plan");
  assert.equal(res.status, 200);
  const body = (await res.json()) as PlanBody;
  assert.equal(body.approach, "[borrado]");
  assert.equal(body.approachErased, true);
});

test("GET /plan: 404 sin plan, 404 sin tarea, 401 sin token", async () => {
  assert.equal((await f.send("GET", "/v1/tasks/1/plan")).status, 404);
  assert.equal((await f.send("GET", "/v1/tasks/9/plan")).status, 404);
  assert.equal((await f.app.request("/v1/tasks/1/plan")).status, 401);
});

test("GET /sessions lista las sesiones con su resultado y uso, sin trayectoria", async () => {
  await f.plan();
  const res = await f.send("GET", "/v1/tasks/1/sessions");
  assert.equal(res.status, 200);
  const { sessions } = (await res.json()) as { sessions: Record<string, unknown>[] };
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.sessionId, "ses_1");
  assert.equal(sessions[0]?.state, "ended");
  assert.equal(sessions[0]?.outcome, "completed");
  assert.deepEqual(sessions[0]?.usage, {
    inputTokens: 1,
    outputTokens: 2,
    estimatedCostUsd: 0.1,
    durationMs: 5,
  });
  assert.doesNotMatch(JSON.stringify(sessions), /prompt|trajectory/i);
  assert.equal((await f.send("GET", "/v1/tasks/9/sessions")).status, 404);
});

test("el detalle de la tarea lleva planVersion: null sin plan y el número con plan", async () => {
  const none = (await (await f.send("GET", "/v1/tasks/1")).json()) as {
    planVersion: number | null;
  };
  assert.equal(none.planVersion, null);
  await f.plan();
  const withPlan = (await (await f.send("GET", "/v1/tasks/1")).json()) as { planVersion: number };
  assert.equal(withPlan.planVersion, 1);
});
