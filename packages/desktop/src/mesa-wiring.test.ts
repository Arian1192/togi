import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// El cableado de la mesa en vivo (4b-2c) toca el lado Tauri, que aquí no se puede ejecutar: se
// comprueba lo que importa del código escrito. El comportamiento, en mesa*.test.ts y en la app real.
const SRC = import.meta.dirname;
const read = (f: string) => readFileSync(join(SRC, f), "utf8");

test("App pinta la mesa con las tareas en planning y lo que te espera, y la escucha en vivo", () => {
  const app = read("App.tsx");
  const pane = read("MesaPane.tsx");
  assert.match(app, /view\.kind === "mesa" \?/);
  assert.match(app, /<MesaPane/);
  assert.match(app, /t\.state === "planning"/);
  assert.match(pane, /listen<Header>\("daemon-event-header"/);
  assert.match(pane, /listen<SessionTag>\("daemon-event-session"/);
  assert.match(pane, /payload\.kind === "open"\) void sow\(\)/, "al reconectar, vuelve a sembrar");
  assert.match(
    pane,
    /payload\.kind === "closed"\) setState\(EMPTY\)/,
    "si se cae, sin datos viejos",
  );
  assert.match(pane, /r\.sessionState === "active"/, "solo lo que de verdad está en curso");
});

test("⌘1 y ⌘2 llegan a la vista desde el teclado y desde la barra de título", () => {
  const app = read("App.tsx");
  assert.match(app, /const next = viewShortcut\(e\);/);
  assert.match(app, /onMesa=\{\(open\) => setView\(open \? \{ kind: "mesa" \} : PENDING\)\}/);
});
