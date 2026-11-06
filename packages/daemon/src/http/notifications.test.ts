import assert from "node:assert/strict";
import { test } from "node:test";
import { notificationRoutes } from "./notifications.ts";

test("GET /v1/notifications devuelve el estado que se le dio", async () => {
  const status = { state: "unavailable", reason: "sin notificaciones en la plataforma linux" };
  const res = await notificationRoutes(status as never).request("/v1/notifications");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), status);
});

test("sin estado, dice que están desactivadas", async () => {
  const res = await notificationRoutes().request("/v1/notifications");
  assert.equal(((await res.json()) as { state: string }).state, "disabled");
});
