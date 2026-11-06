import assert from "node:assert/strict";
import { test } from "node:test";
import { specialistHash } from "../model/specialist.ts";
import { BUILTIN_SPECIALISTS } from "./generic-planner.ts";
import { genericPlannerV2 } from "./generic-planner-v2.ts";

test("el hash de generic-planner@2 está fijado: es la del flujo por defecto y ya es inmutable", () => {
  // Si este test falla, alguien editó la 2. Una versión publicada no se edita: se sube a la 3.
  assert.equal(
    specialistHash(genericPlannerV2),
    "sha256:f1ed338218434e7d82148037f5b02b5eee4b0ea5a531572cf751b3789f744eff",
  );
});

test("la 2 está en el catálogo integrado", () => {
  assert.ok(BUILTIN_SPECIALISTS.includes(genericPlannerV2));
});
