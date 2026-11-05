import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SESSION_COST_USD,
  InvalidSessionCostError,
  MAX_SESSION_COST_USD,
  SESSION_COST_ENV,
  sessionCostCap,
} from "./session-cost.ts";

const cap = (raw?: string) => sessionCostCap(raw === undefined ? {} : { [SESSION_COST_ENV]: raw });

test("sin variable, el tope por defecto", () => {
  assert.deepEqual(cap(), { usd: DEFAULT_SESSION_COST_USD, source: "default" });
});

test("un valor válido se usa tal cual, hasta el máximo", () => {
  assert.deepEqual(cap("0.5"), { usd: 0.5, source: "env" });
  assert.deepEqual(cap("3"), { usd: 3, source: "env" });
  assert.deepEqual(cap(String(MAX_SESSION_COST_USD)), { usd: MAX_SESSION_COST_USD, source: "env" });
});

test("cero, negativo, no numérico, vacío, infinito o por encima del máximo lanzan", () => {
  for (const raw of ["0", "-1", "abc", "", " ", "1e3", "Infinity", "NaN", "1,5", "21", "0x10"]) {
    assert.throws(() => cap(raw), InvalidSessionCostError, JSON.stringify(raw));
  }
});

test("el error no repite un valor largo entero", () => {
  assert.throws(
    () => cap("9".repeat(500)),
    (e: Error) => e.message.length < 250,
  );
});
