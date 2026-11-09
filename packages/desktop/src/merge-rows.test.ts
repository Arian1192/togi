import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeRows, type TaskRow } from "./TaskList.ts";

const row = (number: number, version: number, state: TaskRow["state"] = "draft"): TaskRow => ({
  number,
  title: `tarea ${number}`,
  titleErased: false,
  state,
  repo: "arian1192/togi",
  baseBranch: "main",
  hasCriteria: true,
  updatedAt: "2026-11-07T10:00:00Z",
  version,
});

test("una fila con mayor versión reemplaza a la suya", () => {
  const merged = mergeRows([row(1, 2), row(2, 1)], [row(1, 3, "building")]);
  assert.deepEqual(merged, [row(1, 3, "building"), row(2, 1)]);
});

test("la misma versión también reemplaza, para que una recarga refresque", () => {
  assert.equal(mergeRows([row(1, 2)], [row(1, 2, "review")])[0]?.state, "review");
});

test("una fila con menor versión (una respuesta vieja) no deshace la actual", () => {
  const current = [row(1, 5, "review")];
  assert.deepEqual(mergeRows(current, [row(1, 4, "draft")]), current);
});

test("las tareas nuevas se añaden, las que no llegan se conservan y todo sale por número", () => {
  const merged = mergeRows([row(3, 1), row(1, 1)], [row(2, 1)]);
  assert.deepEqual(
    merged.map((r) => r.number),
    [1, 2, 3],
  );
});

test("no modifica la lista de entrada", () => {
  const current = [row(2, 1), row(1, 1)];
  mergeRows(current, [row(3, 1)]);
  assert.deepEqual(
    current.map((r) => r.number),
    [2, 1],
  );
});
