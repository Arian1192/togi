import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { Actor } from "@togi/core";
import { planFixture } from "./testing/plan-fixture.ts";

let f: Awaited<ReturnType<typeof planFixture>>;
beforeEach(async () => {
  f = await planFixture();
});
afterEach(() => f.close());

const human: Actor = { kind: "human", userId: "usr_1" };
const post = (path: string) =>
  f.send("POST", path, undefined, { "if-match": `"${f.store.currentVersion("task:1")}"` });
const body = async (res: Response) => (await res.json()) as Record<string, unknown>;

test("invalid_state dice en qué estado está la tarea: planning", async () => {
  const res = await post("/v1/tasks/1/plan/approve"); // la tarea está en planning, sin plan
  assert.equal(res.status, 422);
  const problem = await body(res);
  assert.equal(problem.code, "invalid_state");
  assert.equal(problem.state, "planning");
});

test("y plan_review cuando ya hay plan: enviar de nuevo no es posible", async () => {
  await f.plan();
  const res = await post("/v1/tasks/1/submit");
  assert.equal(res.status, 422);
  const problem = await body(res);
  assert.deepEqual([problem.code, problem.state], ["invalid_state", "plan_review"]);
});

test("el estado es el de ese momento: tras aprobar, building", async () => {
  await f.plan();
  assert.equal((await post("/v1/tasks/1/plan/approve")).status, 200);
  const problem = await body(await post("/v1/tasks/1/submit"));
  assert.deepEqual([problem.code, problem.state], ["invalid_state", "building"]);
});

test("el resto de errores de regla no llevan estado", async () => {
  await f.handle(human, {
    type: "reject",
    number: 1,
    category: "scope",
    text: "no procede",
  });
  const res = await post("/v1/tasks/1/submit");
  assert.equal(res.status, 422);
  const problem = await body(res);
  assert.equal(problem.code, "task_final");
  assert.ok(!("state" in problem), "task_final no añade el estado");
});
