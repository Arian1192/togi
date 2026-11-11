import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// El cableado de Actividad toca el lado Tauri, que aquí no se puede ejecutar: se comprueba lo que
// importa del código escrito. La forma de cada movimiento la vigila activity.rs en Rust.
const api = readFileSync(join(import.meta.dirname, "activityApi.ts"), "utf8");

test("read_task_activity se invoca por su nombre, escrito, una sola vez", () => {
  assert.equal((api.match(/invoke(?:<[^>]*>)?\(\s*"read_task_activity"/g) ?? []).length, 1);
});

test("el webview solo manda el número de tarea: nada de rutas, métodos ni cabeceras", () => {
  assert.match(api, /\{ number \}/);
  assert.doesNotMatch(api, /\/v1\/|method|headers/i);
});

test("un fallo al invocar se queda en un motivo cerrado", () => {
  assert.match(api, /status: "unreachable", reason: "app"/);
});

test("los estados no viajan: el movimiento lleva el veredicto y si pasó, para stateAfter", () => {
  assert.doesNotMatch(api, /\b(from|to)\?:/);
  assert.match(api, /verdict\?: PlanDecision\["verdict"\]/);
  assert.match(api, /passed\?: boolean/);
});
