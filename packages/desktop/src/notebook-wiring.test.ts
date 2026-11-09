import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// El cableado del cuaderno (R5b) toca el lado Tauri, que aquí no se puede ejecutar: se comprueba lo
// que importa del código escrito. El comportamiento (leer, aprobar, «el plan cambió», un fallo) está
// probado en notebook.test.ts y, con la interfaz real, en el navegador.
const SRC = import.meta.dirname;
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const api = read("notebookApi.ts");
const pane = read("TaskNotebookPane.tsx");
const app = read("App.tsx");

test("cada comando del cuaderno se invoca por su nombre, escrito, una sola vez", () => {
  for (const name of [
    "read_task",
    "read_plan",
    "approve_plan",
    "reject_plan",
    "request_plan_changes",
  ]) {
    assert.equal(
      (api.match(new RegExp(`invoke(?:<[^>]*>)?\\(\\s*"${name}"`, "g")) ?? []).length,
      1,
      name,
    );
  }
});

test("el webview solo manda el número, la versión que vio y el motivo: nada de rutas ni métodos", () => {
  assert.doesNotMatch(api, /\/v1\/|method|If-Match|headers/i);
  assert.match(api, /const args = \{ number, version \}/);
  assert.match(api, /category: decision\.category, text: decision\.text/);
});

test("el plan solo se pide para una tarea en plan_review", () => {
  assert.match(pane, /loadReview\(number, state === "plan_review"\)/);
  assert.match(api, /withPlan \? invoke<PlanReadResult>\("read_plan"/);
});

test("se vuelve a leer cuando cambia el estado o la versión de la tarea, y una lectura vieja no pisa la actual", () => {
  assert.match(pane, /\[read, version\]/);
  assert.match(pane, /latest\.current === mine/);
  assert.match(pane, /latest\.current \+= 1/);
});

test("una decisión solo sale con un plan leído, y mientras hay una en curso no sale otra", () => {
  assert.match(pane, /review\.version === null \|\| busy/);
  assert.match(pane, /sendDecision\(number, review\.version, decision\)/);
});

test("App abre el cuaderno de la tarea elegida, con su estado y su versión, y lo reinicia al cambiar de tarea", () => {
  assert.match(app, /<TaskNotebookPane\s+key=\{opened\.number\}/);
  assert.match(app, /state=\{opened\.state\}/);
  assert.match(app, /version=\{opened\.version\}/);
  assert.match(app, /view\.kind === "task"/);
});
