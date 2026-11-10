import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// La ventana arranca con el tamaño del lienzo del diseño (1440 × 900), centrada, y no se puede hacer
// tan pequeña que a la mesa no le quede sitio: con la columna (288 px) y el lateral (320 px) abiertos,
// a 1100 px el mapa aún tiene unos 500.
const conf = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "src-tauri", "tauri.conf.json"), "utf8"),
) as { app: { windows: Record<string, unknown>[] } };
const [main] = conf.app.windows;

test("la ventana arranca a 1440 × 900 y centrada", () => {
  assert.equal(main?.width, 1440);
  assert.equal(main?.height, 900);
  assert.equal(main?.center, true);
});

test("como mínimo, 1100 × 700: a la mesa le quedan unos 500 px de mapa", () => {
  assert.equal(main?.minWidth, 1100);
  assert.equal(main?.minHeight, 700);
  assert.ok((main?.minWidth as number) - 288 - 320 >= 490);
});
