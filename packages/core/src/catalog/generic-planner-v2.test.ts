import assert from "node:assert/strict";
import { test } from "node:test";
import { publishSpecialist } from "../flow/publish-specialist.ts";
import { SpecialistSchema, specialistHash } from "../model/specialist.ts";
import { genericPlanner } from "./generic-planner.ts";
import { genericPlannerV2 } from "./generic-planner-v2.ts";

const AT = "2026-01-01T00:00:00.000Z";
// El hash de la 1 está fijado: cada versión es inmutable, y si cambia, alguien la editó.
const V1_HASH = "sha256:f02fa149c53162c4f65d588ae8ac39eefdf325f0dc536caf354e071d0c603eab";
const text = genericPlannerV2.instructions;

test("generic-planner@2 es válido y comparte rol, runtime, modelo y herramientas con la 1", () => {
  assert.ok(SpecialistSchema.safeParse(genericPlannerV2).success);
  assert.equal(genericPlannerV2.id, genericPlanner.id);
  assert.equal(genericPlannerV2.version, 2);
  for (const key of ["role", "runtime", "model", "tools"] as const) {
    assert.deepEqual(genericPlannerV2[key], genericPlanner[key], key);
  }
  assert.notEqual(genericPlannerV2.tools, genericPlanner.tools, "no comparten el array");
});

test("conserva las reglas de la 1", () => {
  for (const line of genericPlanner.instructions.split("\n")) assert.ok(text.includes(line), line);
});

test("la 2 pide leer los ficheros que estima, las piezas parecidas y el código de lo que toca", () => {
  assert.match(text, /Antes de estimar las líneas de un fichero, léelo/);
  assert.match(text, /Lee las piezas parecidas[^.]*sigue sus convenciones/);
  assert.match(text, /Comprueba en el código cómo funciona lo que el plan toca[^.]*no lo supongas/);
});

test("la 2 nunca propone debilitar tests y lista los cambios como pendientes de autorización", () => {
  assert.match(text, /Nunca propongas borrar, mover ni debilitar tests para que algo pase/);
  assert.match(text, /los lista uno por uno, con el porqué/);
  assert.match(text, /«cambio que necesita autorización humana»/);
});

test("la 2 pide el enfoque en pasos cortos y numerados, uno por línea", () => {
  assert.match(text, /El enfoque va en pasos cortos y numerados, uno por línea/);
});

test("las instrucciones no citan números de principios", () => {
  assert.doesNotMatch(text, /principio \d/i);
});

test("generic-planner@1 no cambia: sin las reglas nuevas y con el mismo hash", () => {
  assert.equal(specialistHash(genericPlanner), V1_HASH);
  assert.equal(genericPlanner.version, 1);
  assert.doesNotMatch(genericPlanner.instructions, /debilitar tests|Antes de estimar/);
});

test("publicar la 2 tras la 1 es una versión nueva; repetirla no hace nada", () => {
  const history = [{ version: 1, hash: V1_HASH }];
  const events = publishSpecialist(history, genericPlannerV2, AT);
  assert.ok(Array.isArray(events));
  assert.equal(events.length, 1);
  const hash = specialistHash(genericPlannerV2);
  assert.notEqual(hash, V1_HASH, "el hash no choca con el de la 1");
  assert.deepEqual(publishSpecialist([...history, { version: 2, hash }], genericPlannerV2, AT), []);
});
