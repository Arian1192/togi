import assert from "node:assert/strict";
import { test } from "node:test";
import { genericPlanner } from "../catalog/generic-planner.ts";
import { genericPlannerV2 } from "../catalog/generic-planner-v2.ts";
import { DEFAULT_FLOW, planningProducer } from "./default-flow.ts";

test("el flujo por defecto: generic-planner@2 y ningún evaluador", () => {
  assert.deepEqual(DEFAULT_FLOW.planning.producer, { id: "generic-planner", version: 2 });
  assert.deepEqual(DEFAULT_FLOW.evaluators, []);
});

test("el productor se resuelve en el catálogo por id y versión exactos", () => {
  assert.equal(planningProducer(DEFAULT_FLOW), genericPlannerV2);
  assert.equal(planningProducer(DEFAULT_FLOW, [genericPlanner]), undefined);
  const flow = { ...DEFAULT_FLOW, planning: { producer: { id: "generic-planner", version: 1 } } };
  assert.equal(planningProducer(flow, [genericPlanner, genericPlannerV2]), genericPlanner);
});
