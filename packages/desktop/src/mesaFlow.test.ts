import assert from "node:assert/strict";
import { test } from "node:test";
import { applyHeader, EMPTY, type Header, type MesaState, seed, type Who } from "./mesa.ts";
import { placeNodes, SIZE } from "./mesaFlow.ts";

// Los nodos de la mesa que se puede mover (React Flow), como en la pantalla 5 del diseño. Arrastrar
// un nodo no cambia quién está ni qué dice.

const at = "2026-11-10T09:30:00.000Z";
const h = (seq: number, number: number, name: string, actor: Who, session?: string): Header => ({
  seq,
  at,
  number,
  name,
  actor,
  ...(session === undefined ? {} : { session }),
});
const togi: Who = { kind: "system", component: "adapter:planner" };
const play = (state: MesaState, ...hs: Header[]) => hs.reduce(applyHeader, state);

test("como en el diseño: togi en el centro, tú encima y las plazas a izquierda y derecha", () => {
  const s = play(
    EMPTY,
    h(1, 7, "session.started", togi, "sa"),
    h(2, 8, "session.started", togi, "sb"),
  );
  const nodes = placeNodes(s, 0);
  assert.deepEqual(
    nodes.map((n) => n.id),
    ["you", "sa", "sb", "togi"],
  );
  const node = (id: string) => nodes.find((n) => n.id === id);
  assert.deepEqual(node("togi")?.position, {
    x: 440 - SIZE.togi.width / 2,
    y: 330 - SIZE.togi.height / 2,
  });
  assert.equal(
    (node("you")?.position.x ?? 0) + SIZE.you.width / 2,
    440,
    "tú, en la vertical de togi",
  );
  assert.ok((node("sa")?.position.x ?? 0) + SIZE.seat.width < 440, "la primera, a la izquierda");
  assert.ok((node("sb")?.position.x ?? 0) > 440, "la segunda, a la derecha");
});

test("cada plaza dice su tarea, su rol, la hora y el último mensaje; la terminada, que terminó", () => {
  const s = play(
    EMPTY,
    h(1, 7, "session.started", togi, "sa"),
    h(2, 7, "plan.proposed", { kind: "agent", role: "planner" }, "sa"),
    h(3, 8, "session.started", togi, "sb"),
    h(4, 8, "session.ended", togi, "sb"),
  );
  const nodes = placeNodes(s, 2, new Map(), new Map([[7, "Exportar promociones a CSV"]]));
  assert.deepEqual(nodes.find((n) => n.id === "sa")?.data, {
    tone: "is-active",
    label: "#7 · Exportar promociones a CSV",
    title: "Planificador",
    meta: "09:30",
    glyph: "◐",
    note: "plan.proposed",
  });
  const done = nodes.find((n) => n.id === "sb")?.data;
  assert.deepEqual(
    [done?.tone, done?.label, done?.glyph, done?.note],
    ["is-done", "#8", "○", "terminado"],
  );
  const you = nodes.find((n) => n.id === "you")?.data;
  assert.deepEqual([you?.waiting, you?.glyph, you?.note], [true, "◆", "2 te esperan"]);
  assert.equal(nodes.find((n) => n.id === "togi")?.data.note, "log · seq 4");
});

test("un nodo arrastrado se queda donde lo dejas; los demás no se mueven", () => {
  const s = play(EMPTY, h(1, 7, "session.started", togi, "sa"));
  const before = placeNodes(s, 0);
  const after = placeNodes(s, 0, new Map([["sa", { x: 10, y: 20 }]]));
  assert.deepEqual(after.find((n) => n.id === "sa")?.position, { x: 10, y: 20 });
  for (const id of ["you", "togi"]) {
    assert.deepEqual(
      after.find((n) => n.id === id)?.position,
      before.find((n) => n.id === id)?.position,
    );
  }
});

test("la plaza sembrada que adopta su sesión conserva el sitio donde la dejaste", () => {
  const seeded = seed([7], 4);
  const moved = new Map([["planner#7", { x: 5, y: 6 }]]);
  assert.deepEqual(placeNodes(seeded, 0, moved)[1]?.position, { x: 5, y: 6 });
  const adopted = play(seeded, h(5, 7, "plan.proposed", { kind: "agent", role: "planner" }, "sa"));
  assert.equal(adopted.seats[0]?.key, "sa");
  assert.deepEqual(placeNodes(adopted, 0, moved)[1]?.position, { x: 5, y: 6 });
  // Una segunda sesión del mismo rol y tarea no hereda ese sitio.
  const two = play(adopted, h(6, 7, "session.started", togi, "sb"));
  assert.notDeepEqual(placeNodes(two, 0, moved)[2]?.position, { x: 5, y: 6 });
});

test("con más plazas de las que caben, las que sobran se agrupan en «+N más»", () => {
  const hs = Array.from({ length: 10 }, (_, i) =>
    h(i + 1, 10 + i, "session.started", togi, `s${i}`),
  );
  const nodes = placeNodes(play(EMPTY, ...hs), 0);
  const more = nodes.find((n) => n.id === "more")?.data;
  assert.deepEqual([more?.title, more?.note], ["+3 más", "3 en curso"]);
  assert.equal(nodes.length, 1 + 7 + 1 + 1, "tú, 7 plazas, «+N más» y togi");
});

test("cada asidero está en el lado de la tarjeta que mira a togi, en su punto exacto", () => {
  const s = play(EMPTY, h(1, 7, "session.started", togi, "sa"));
  const handles = (id: string) =>
    placeNodes(s, 0)
      .find((n) => n.id === id)
      ?.handles?.map((x) => [x.id, x.type, x.x, x.y]);
  assert.deepEqual(handles("you"), [["bottom", "source", SIZE.you.width / 2, SIZE.you.height]]);
  assert.deepEqual(handles("sa"), [
    ["left", "source", 0, 62],
    ["right", "source", SIZE.seat.width, 62],
  ]);
  assert.deepEqual(handles("togi"), [
    ["left", "target", 0, 48],
    ["right", "target", 96, 48],
    ["top", "target", 48, 0],
  ]);
});
