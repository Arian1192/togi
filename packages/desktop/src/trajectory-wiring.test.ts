import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// El cableado de la trayectoria (R6b) toca el lado Tauri, que aquí no se puede ejecutar: se comprueba
// lo que importa del código escrito. El comportamiento está en trajectory.test.ts y
// trajectory-section.test.ts y, con la interfaz real, en el navegador.
const SRC = import.meta.dirname;
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const api = read("trajectoryApi.ts");
const pane = read("TrajectoryPane.tsx");
const notebook = read("TaskNotebookPane.tsx");

test("read_trajectory se invoca por su nombre, escrito, una sola vez", () => {
  assert.equal((api.match(/invoke(?:<[^>]*>)?\(\s*"read_trajectory"/g) ?? []).length, 1);
});

test("el webview solo manda el número, el cursor y la marca: nada de rutas, sesiones ni métodos", () => {
  assert.match(api, /\{ number, after, mark \}/);
  assert.doesNotMatch(api, /\/v1\/|method|headers|session_?id|sessionId/i);
});

test("un fallo al invocar se queda en un motivo cerrado", () => {
  assert.match(api, /status: "unreachable", reason: "app"/);
});

test("cada página se junta con applyPage y la petición sale de pageRequest", () => {
  assert.match(pane, /applyPage\(/);
  assert.match(pane, /pageRequest\(/);
  assert.match(pane, /readTrajectory\(number, after, mark\)/);
});

test("si cambia la sesión se relee desde el principio, sin soltar la lectura en curso", () => {
  assert.match(pane, /result\.status === "session_changed"/);
});

test("una respuesta tras desmontar se descarta y no salen dos lecturas a la vez", () => {
  assert.match(pane, /latest\.current !== mine/);
  assert.match(pane, /reading\.current/);
  // Solo al desmontar: si plegar descartara la respuesta, la lectura se quedaría en curso para siempre.
  assert.match(
    pane,
    /useEffect\(\s*\(\) => \(\) => \{\s*latest\.current \+= 1;\s*\},\s*\[\],?\s*\)/,
  );
});

test("se lee al abrirla y se relee, si está abierta, cuando cambia la tarea", () => {
  assert.match(pane, /\[open, version, load\]/);
});

test("el cuaderno pinta la trayectoria de su tarea, con su versión", () => {
  assert.match(notebook, /<TrajectoryPane number=\{number\} version=\{version\} \/>/);
});
