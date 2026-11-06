import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { Actor } from "@togi/core";
import type { PlannerStatus } from "../orchestrator/planner-status.ts";
import { createApp } from "./app.ts";
import { planFixture, TOKEN } from "./testing/plan-fixture.ts";

const ACTIVE: PlannerStatus = { state: "active", reason: "agente real" };
const system: Actor = { kind: "system", component: "adapter:planner" };

let f: Awaited<ReturnType<typeof planFixture>>;
beforeEach(async () => {
  f = await planFixture();
});
afterEach(() => f.close());

/** La misma app de la fixture, pero con el planificador en el estado dado. */
const appWith = (planner?: PlannerStatus) =>
  createApp(
    f.db,
    f.handle,
    { store: f.store, blobs: f.blobs, agentEvents: undefined as never },
    undefined,
    undefined,
    planner,
  );
const retry = (
  n: string | number = 1,
  planner: PlannerStatus | null = ACTIVE,
  headers: Record<string, string> = { "if-match": `"${f.store.currentVersion("task:1")}"` },
) =>
  appWith(planner ?? undefined).request(`/v1/tasks/${n}/plan/retry`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, ...headers },
  });
const lastEvents = (n = 3) =>
  f.db
    .prepare("SELECT type, actor FROM events ORDER BY seq DESC LIMIT ?")
    .all(n)
    .map((e) => ({ ...(e as { type: string; actor: string }) }));
const count = () => (f.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
const code = async (res: Response) => ((await res.json()) as { code: string }).code;

test("en planning, sin sesión activa: 200 y plan.retry_requested con el usuario del token", async () => {
  const res = await retry();
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { state: string }).state, "planning");
  const last = lastEvents(1)[0];
  assert.equal(last?.type, "plan.retry_requested");
  assert.deepEqual(JSON.parse(last?.actor ?? "null"), { kind: "human", userId: "usr_1" });
});

test("fuera de planning, 422 invalid_state y no se escribe nada", async () => {
  await f.plan(); // plan_review
  const before = count();
  const res = await retry();
  assert.equal(res.status, 422);
  assert.equal(await code(res), "invalid_state");
  assert.equal(count(), before);
});

test("con una sesión activa, 422 session_already_active y no se escribe nada", async () => {
  await f.handle(system, {
    type: "startSession",
    number: 1,
    session: {
      sessionId: "ses_9",
      role: "planner",
      cycle: null,
      runtime: { id: "fake", version: "1" },
      model: "m",
      specialist: { id: "generic-planner", version: 1, hash: "sha256:abc" },
      workspaceId: null,
      prompt: "p",
      policy: "q",
    },
  });
  const before = count();
  const res = await retry();
  assert.equal(res.status, 422);
  assert.equal(await code(res), "session_already_active");
  assert.equal(count(), before);
});

test("una tarea que no existe da 404 y sin token 401", async () => {
  const missing = await retry(99);
  assert.equal(missing.status, 404);
  assert.equal(await code(missing), "task_not_found");
  assert.equal((await retry("abc")).status, 404);
  const anonymous = await appWith(ACTIVE).request("/v1/tasks/1/plan/retry", { method: "POST" });
  assert.equal(anonymous.status, 401);
});

test("sin If-Match 428 y con una versión vieja 412, y no se escribe nada", async () => {
  const before = count();
  assert.equal((await retry(1, ACTIVE, {})).status, 428);
  const old = await retry(1, ACTIVE, { "if-match": `"${f.store.currentVersion("task:1") - 1}"` });
  assert.equal(old.status, 412);
  assert.equal(count(), before);
});

test("sin planificador activo, 503 not_configured y no se escribe nada", async () => {
  const before = count();
  for (const planner of [
    null, // el daemon no pasó ningún estado

    { state: "disabled", reason: "TOGI_PLANNER=off" },
    { state: "unavailable", reason: "sin sandbox" },
  ] as const) {
    const res = await retry(1, planner);
    assert.equal(res.status, 503);
    assert.equal(await code(res), "not_configured");
  }
  assert.equal(count(), before);
});
