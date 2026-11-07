import assert from "node:assert/strict";
import { test } from "node:test";
import { REASON_CATEGORIES } from "@togi/core";
import type { PlanData } from "./PlanNotebook.ts";
import {
  CATEGORY_LABEL,
  type FormState,
  formReducer,
  NO_FORM,
  planProblem,
  reasonOf,
} from "./planDecision.ts";

const plan = (production: number, tests: number): PlanData => ({
  planVersion: 1,
  files: [],
  newTests: [],
  approach: "",
  approachErased: false,
  estimatedLines: { production, tests },
});

test("un plan dentro de los límites se puede aprobar", () => {
  assert.equal(planProblem(plan(40, 90)), null);
  assert.equal(planProblem(plan(200, 300)), null);
});

test("un plan que pasa de los límites no se puede aprobar y dice por qué", () => {
  assert.match(planProblem(plan(201, 0)) ?? "", /200 líneas de producción/);
  assert.match(planProblem(plan(200, 301)) ?? "", /500 líneas en total/);
});

test("el formulario de motivo abre, rellena y cancela", () => {
  let s = formReducer(NO_FORM, { type: "open", kind: "reject" });
  assert.deepEqual(s, { kind: "reject", category: "", text: "" });
  s = formReducer(formReducer(s, { type: "category", value: "scope" }), {
    type: "text",
    value: "fuera de alcance",
  });
  assert.deepEqual(s, { kind: "reject", category: "scope", text: "fuera de alcance" });
  assert.deepEqual(formReducer(s, { type: "open", kind: "request_changes" }), {
    kind: "request_changes",
    category: "",
    text: "",
  });
  assert.deepEqual(formReducer(s, { type: "cancel" }), NO_FORM);
});

test("el motivo exige categoría de la lista cerrada y texto no vacío y de a lo sumo 5000", () => {
  const form = (category: string, text: string): FormState => ({ kind: "reject", category, text });
  assert.deepEqual(reasonOf(form("tests", "  faltan casos  ")), {
    category: "tests",
    text: "faltan casos",
  });
  assert.equal(reasonOf(form("", "x")), null);
  assert.equal(reasonOf(form("nope", "x")), null);
  assert.equal(reasonOf(form("scope", " \n ")), null);
  assert.notEqual(reasonOf(form("scope", "a".repeat(5000))), null);
  assert.equal(reasonOf(form("scope", "a".repeat(5001))), null);
});

test("cada categoría cerrada de core tiene su etiqueta", () => {
  assert.deepEqual(Object.keys(CATEGORY_LABEL), [...REASON_CATEGORIES]);
});
