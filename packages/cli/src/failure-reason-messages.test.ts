import assert from "node:assert/strict";
import { test } from "node:test";
import { FAILURE_REASONS } from "@togi/core";
import { MESSAGES } from "./messages.ts";

test("cada código de fallo de core tiene su mensaje en el catálogo", () => {
  for (const code of FAILURE_REASONS) {
    const message = MESSAGES[`failure_reason_${code}`]?.({});
    assert.ok(message, `falta failure_reason_${code}`);
    assert.ok(message.text.length > 0);
  }
});

test("un código desconocido o con caracteres de control no los pinta tal cual", () => {
  const line = MESSAGES.plan_not_found?.({ n: 1, reason: "raro\u001b[31m" }).text ?? "";
  assert.ok(!line.includes(String.fromCharCode(27)));
  assert.match(line, /Última sesión: raro\[31m\./);
});
