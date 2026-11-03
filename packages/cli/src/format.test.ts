import assert from "node:assert/strict";
import { test } from "node:test";
import { headerIndent } from "./format.ts";

test("la sangría de la cabecera de task show es el ancho de #N más dos espacios", () => {
  assert.equal(headerIndent(1), "    ");
  assert.equal(headerIndent(12), "     ");
  assert.equal(headerIndent(123), "      ");
  assert.equal(headerIndent(12345), "        ");
});
