import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRefit } from "./MesaMap.ts";

// Cuándo se reencuadra la mesa: una plaza que entra tiene que verse entera, y al volver a la mesa
// se queda el encuadre que dejaste.

test("hasta que todos los nodos están medidos, no encuadra: React Flow aún no sabe cuánto ocupan", () => {
  assert.equal(shouldRefit("you sa togi", false, null), false);
  assert.equal(shouldRefit("you sa togi", true, null), true);
});

test("al volver a la mesa con los mismos nodos, se queda tu encuadre; si alguien entró, encuadra", () => {
  assert.equal(shouldRefit("you sa togi", true, "you sa togi"), false);
  assert.equal(shouldRefit("you sa sb togi", true, "you sa togi"), true);
});
