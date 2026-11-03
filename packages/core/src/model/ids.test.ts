import assert from "node:assert/strict";
import { test } from "node:test";
import { SAFE_ID } from "./ids.ts";

test("SAFE_ID acepta ids razonables", () => {
  for (const id of ["7f3a9c", "req-abc", "a.b:c_d", crypto.randomUUID(), "a".repeat(128)]) {
    assert.ok(SAFE_ID.test(id), id);
  }
});

test("SAFE_ID rechaza vacíos, largos y caracteres de control", () => {
  for (const id of ["", "a".repeat(129), "con espacio", "a\nb", "a\x1b[31m", "a/b", "ñ"]) {
    assert.ok(!SAFE_ID.test(id), JSON.stringify(id));
  }
});
