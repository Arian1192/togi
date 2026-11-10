import assert from "node:assert/strict";
import { test } from "node:test";
import { seatPoint } from "./mesaFlow.ts";
import { mesaMemory } from "./mesaMemory.ts";

// La mesa llena: con muchas plazas, las filas se juntan para que quepa sin alejarse tanto.

const gap = (count: number) => (seatPoint(2, count).y - seatPoint(0, count).y) as number;

test("con una o dos filas, las plazas van holgadas, como en el diseño", () => {
  assert.equal(gap(4), 200);
});

test("con tres filas o más, se juntan", () => {
  assert.equal(gap(5), 130);
  assert.equal(gap(8), 130);
  const top = seatPoint(0, 8);
  assert.ok(top.y > 120, "la fila de arriba no se mete en el sitio de tú");
});

test("al empezar, el encuadre es de la mesa: si cambia la ventana, vuelve a encuadrar", () => {
  assert.equal(mesaMemory.framed, true);
});
