import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLE_TOOLS } from "@togi/core";
import { PLANNER_TOOLS } from "./planner-policy.ts";

test("las herramientas del adaptador son las del rol planificador de core", () => {
  assert.deepEqual([...PLANNER_TOOLS], [...ROLE_TOOLS.planner]);
});
