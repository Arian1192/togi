import assert from "node:assert/strict";
import { test } from "node:test";
import { genericPlanner } from "../catalog/generic-planner.ts";
import { specialistHash } from "../model/specialist.ts";
import { isDomainError } from "./errors.ts";
import { publishSpecialist } from "./publish-specialist.ts";

const at = "2026-11-05T10:00:00.000Z";

test("la primera publicación emite un evento con el contenido y el hash", () => {
  const result = publishSpecialist([], genericPlanner, at);
  assert.ok(!isDomainError(result));
  assert.equal(result.length, 1);
  assert.equal(result[0]?.type, "specialist.version_published");
  assert.deepEqual(result[0]?.payload, {
    specialist: genericPlanner,
    hash: specialistHash(genericPlanner),
  });
  assert.deepEqual(result[0]?.actor, { kind: "system", component: "catalog" });
});

test("publicar lo mismo otra vez no emite nada", () => {
  const history = [{ version: 1, hash: specialistHash(genericPlanner) }];
  assert.deepEqual(publishSpecialist(history, genericPlanner, at), []);
});

test("el mismo id y versión con otro contenido se rechaza", () => {
  const history = [{ version: 1, hash: specialistHash(genericPlanner) }];
  const result = publishSpecialist(history, { ...genericPlanner, instructions: "Otra." }, at);
  assert.ok(isDomainError(result));
  assert.equal(result.code, "specialist_version_conflict");
  assert.match(result.message, /sube la versión/);
});

test("otra versión con otro contenido se acepta", () => {
  const history = [{ version: 1, hash: specialistHash(genericPlanner) }];
  const v2 = { ...genericPlanner, version: 2, instructions: "Otra." };
  const result = publishSpecialist(history, v2, at);
  assert.ok(!isDomainError(result));
  assert.equal(result.length, 1);
});

test("un especialista que pide más que su rol no llega a publicarse", () => {
  const result = publishSpecialist([], { ...genericPlanner, tools: ["Read", "Bash"] }, at);
  assert.ok(isDomainError(result));
  assert.equal(result.code, "invalid_specialist");
});
