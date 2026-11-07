import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanData, TaskCover } from "./PlanNotebook.ts";
import { PlanReview, type Review } from "./PlanReview.ts";

const task: TaskCover = {
  number: 12,
  title: "Añadir filtro",
  titleErased: false,
  risk: "low",
  repo: "arian1192/togi",
  criteria: "Filtra por fecha.",
  criteriaErased: false,
};
const plan: PlanData = {
  planVersion: 2,
  files: [{ path: "src/a.ts", change: "modify" }],
  newTests: [],
  approach: "Primero A.",
  approachErased: false,
  estimatedLines: { production: 40, tests: 90 },
};
const html = (review: Review, notice: string | null = null, busy = false) =>
  renderToStaticMarkup(
    createElement(PlanReview, { review, notice, busy, onDecide: () => {}, onBack: () => {} }),
  );

test("mientras lee dice que lee, y siempre se puede volver a la lista", () => {
  const out = html({ status: "loading" });
  assert.match(out, /Leyendo el plan…/);
  assert.match(out, /btn btn-secondary">Volver a la lista</);
  assert.doesNotMatch(out, /notebook/);
});

test("si no se puede leer, dice el motivo cerrado y no pinta el cuaderno", () => {
  const out = html({ status: "error", reason: "no_socket" });
  assert.match(out, /No se pudo leer el plan \(no_socket\)\./);
  assert.doesNotMatch(out, /Aprobar el plan/);
});

test("con el plan leído pinta el cuaderno entero", () => {
  const out = html({ status: "ready", task, plan, version: 7 });
  assert.match(out, /class="notebook"/);
  assert.match(out, /btn btn-primary">Aprobar el plan</);
  assert.doesNotMatch(out, /notebook-notice/);
});

test("el aviso del último intento sale como texto, no como HTML", () => {
  const out = html({ status: "ready", task, plan, version: 7 }, "<b>cambió</b>");
  assert.match(out, /<p role="status" class="notebook-notice">&lt;b&gt;cambió&lt;\/b&gt;<\/p>/);
});

test("ocupado, los botones del cuaderno se desactivan", () => {
  const out = html({ status: "ready", task, plan, version: 7 }, null, true);
  assert.equal((out.match(/disabled=""/g) ?? []).length, 3);
});
