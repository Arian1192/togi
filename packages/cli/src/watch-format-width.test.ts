import assert from "node:assert/strict";
import { test } from "node:test";
import { EVENT_TYPES } from "@togi/core";
import { formatEvent, TYPE_WIDTH } from "./commands/watch.ts";
import type { WatchedEvent } from "./event-stream.ts";

const event = (type: string): WatchedEvent => ({
  seq: 1,
  stream: "task:5",
  type,
  at: "2026-11-06T10:00:00Z",
  actor: { kind: "human", userId: "usr_1" },
});
/** Dónde empieza la columna de la tarea (`#5`, única: el seq es #1). */
const taskColumn = (type: string) => formatEvent(event(type)).indexOf("  #5  ");

test("el catálogo incluye los tipos largos que descuadraban la columna", () => {
  for (const type of ["specialist.version_published", "plan.retry_requested", "task.created"]) {
    assert.ok(EVENT_TYPES.includes(type), type);
  }
});

test("el ancho es el del tipo más largo del catálogo", () => {
  assert.equal(TYPE_WIDTH, Math.max(...EVENT_TYPES.map((t) => t.length)));
  assert.ok(TYPE_WIDTH >= "specialist.version_published".length);
});

test("la columna de la tarea empieza en el mismo sitio para todos los tipos, cortos o largos", () => {
  const positions = new Set([...EVENT_TYPES, "?"].map(taskColumn));
  assert.equal(positions.size, 1, [...positions].join(","));
  assert.ok(!positions.has(-1));
});

test("un tipo desconocido o con caracteres raros se muestra como ? y no descuadra", () => {
  assert.equal(taskColumn("raro\u001b[31m"), taskColumn("task.created"));
});
