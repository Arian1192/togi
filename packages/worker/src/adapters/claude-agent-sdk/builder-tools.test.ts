import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLE_TOOLS } from "@togi/core";
import { BUILDER_TOOLS } from "./builder-policy.ts";

test("las herramientas del adaptador son las del rol builder de core", () => {
  assert.deepEqual([...BUILDER_TOOLS], [...ROLE_TOOLS.builder]);
});
