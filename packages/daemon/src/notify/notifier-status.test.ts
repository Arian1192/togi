import assert from "node:assert/strict";
import { test } from "node:test";
import { createNotifier } from "./notifier.ts";

const status = (deps: Parameters<typeof createNotifier>[0]) => createNotifier(deps).status;

test("status dice activas en macOS", () => {
  assert.deepEqual(status({ platform: "darwin", env: {} }), {
    state: "active",
    reason: "avisos de macOS",
  });
});

test("status dice desactivadas con TOGI_NOTIFY=off, con un motivo fijo", () => {
  assert.deepEqual(status({ platform: "darwin", env: { TOGI_NOTIFY: "off" } }), {
    state: "disabled",
    reason: "TOGI_NOTIFY=off en el entorno del daemon",
  });
});

test("status dice no disponibles fuera de macOS", () => {
  assert.deepEqual(status({ platform: "linux", env: {} }), {
    state: "unavailable",
    reason: "sin notificaciones en la plataforma linux",
  });
});
