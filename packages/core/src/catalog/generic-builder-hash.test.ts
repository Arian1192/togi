import assert from "node:assert/strict";
import { test } from "node:test";
import { specialistHash } from "../model/specialist.ts";
import { genericBuilder } from "./generic-builder.ts";

test("el hash de generic-builder@1 está fijado: una versión publicada no se edita", () => {
  // Si este test falla, alguien editó la 1. Un cambio, también de esfuerzo, es generic-builder@2.
  assert.equal(
    specialistHash(genericBuilder),
    "sha256:a255b9262932892b9b2ac3086df40e2e04cd819d2957a68cc6914e6a18ae162d",
  );
});
