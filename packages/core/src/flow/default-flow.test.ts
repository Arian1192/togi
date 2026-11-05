import assert from "node:assert/strict";
import { test } from "node:test";
import { genericPlanner } from "../catalog/generic-planner.ts";
import { DEFAULT_FLOW, planningProducer } from "./default-flow.ts";

test("el flujo por defecto: generic-planner@1 y ningún evaluador", () => {
  assert.deepEqual(DEFAULT_FLOW.planning.producer, { id: "generic-planner", version: 1 });
  assert.deepEqual(DEFAULT_FLOW.evaluators, []);
});

test("el productor se resuelve en el catálogo por id y versión exactos", () => {
  assert.equal(planningProducer(DEFAULT_FLOW), genericPlanner);
  const v2 = { ...genericPlanner, version: 2 };
  assert.equal(planningProducer(DEFAULT_FLOW, [v2]), undefined);
  const flow = { ...DEFAULT_FLOW, planning: { producer: { id: "generic-planner", version: 2 } } };
  assert.equal(planningProducer(flow, [genericPlanner, v2]), v2);
});
