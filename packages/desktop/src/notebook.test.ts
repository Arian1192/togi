import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  outcomeEffect,
  PLAN_CHANGED,
  type PlanReadResult,
  reviewFrom,
  type TaskReadResult,
} from "./notebook.ts";
import type { PlanData, TaskCover } from "./PlanNotebook.ts";
import { TaskNotebook } from "./TaskNotebook.ts";

const css = readFileSync(join(import.meta.dirname, "app.css"), "utf8");

const COVER: TaskCover = {
  number: 38,
  title: "merge-pr.sh espera a los jobs",
  titleErased: false,
  risk: "medium",
  repo: "arian1192/togi",
  criteria: "Tras actualizar la rama espera a que aparezcan los jobs.",
  criteriaErased: false,
};
const PLAN: PlanData = {
  planVersion: 2,
  files: [{ path: "tools/merge-pr.sh", change: "modify" }],
  newTests: ["tools/merge-pr.test.ts"],
  approach: "Esperar a que el PR tenga checks antes de decidir.",
  approachErased: false,
  estimatedLines: { production: 24, tests: 60 },
};
const okTask: TaskReadResult = { status: "ok", task: COVER };
const okPlan: PlanReadResult = { status: "ok", plan: PLAN, version: 7 };

test("con la portada y el plan leídos, la revisión está lista y lleva la versión del plan", () => {
  assert.deepEqual(reviewFrom(okTask, okPlan), {
    status: "ready",
    task: COVER,
    plan: PLAN,
    version: 7,
  });
});

test("una tarea sin plan por revisar (no se pidió) está lista con solo la portada", () => {
  assert.deepEqual(reviewFrom(okTask, undefined), {
    status: "ready",
    task: COVER,
    plan: null,
    version: null,
  });
});

test("si falla la portada o el plan, el motivo es el cerrado del comando y no hay datos a medias", () => {
  const down: TaskReadResult = { status: "unreachable", reason: "no_socket" };
  assert.deepEqual(reviewFrom(down, okPlan), { status: "error", reason: "no_socket" });
  assert.deepEqual(reviewFrom(okTask, { status: "unreachable", reason: "not_found" }), {
    status: "error",
    reason: "not_found",
  });
  assert.deepEqual(reviewFrom(null, null), { status: "error", reason: "app" });
});

test("el resultado de una decisión: ok recarga, plan_changed recarga con aviso, failed avisa, cancelled no hace nada", () => {
  assert.deepEqual(outcomeEffect({ status: "ok" }), { kind: "reload", notice: null });
  assert.deepEqual(outcomeEffect({ status: "plan_changed" }), {
    kind: "reload",
    notice: PLAN_CHANGED,
  });
  assert.deepEqual(outcomeEffect({ status: "cancelled" }), { kind: "none" });
  const failed = outcomeEffect({ status: "failed", reason: "unauthorized" });
  assert.equal(failed.kind, "notice");
  assert.match(failed.kind === "notice" ? failed.notice : "", /unauthorized.*sigue sin decidir/s);
});

const html = (props: Parameters<typeof TaskNotebook>[0]) =>
  renderToStaticMarkup(createElement(TaskNotebook, props));
const base = { notice: null, busy: false, onDecide: () => {}, state: "plan_review" as const };

test("mientras lee dice que lee, y si falla dice por qué, sin enseñar nada más", () => {
  assert.match(html({ ...base, review: { status: "loading" } }), /Leyendo la tarea/);
  const err = html({ ...base, review: { status: "error", reason: "no_socket" } });
  assert.match(err, /No se pudo leer la tarea \(no_socket\)/);
  assert.doesNotMatch(err, /Aprobar/);
});

test("una tarea con plan por revisar muestra el cuaderno con sus tres decisiones", () => {
  const out = html({ ...base, review: reviewFrom(okTask, okPlan) });
  for (const label of ["Aprobar el plan", "Pedir cambios", "Rechazar el plan"]) {
    assert.match(out, new RegExp(label));
  }
  assert.match(out, /tools\/merge-pr\.sh/);
});

test("una tarea sin plan por revisar muestra su portada y su estado, sin botones de decisión", () => {
  const out = html({ ...base, state: "building", review: reviewFrom(okTask, undefined) });
  assert.match(out, /<h1[^>]*>merge-pr\.sh espera a los jobs<\/h1>/);
  assert.match(out, /arian1192\/togi · #38 · riesgo medio/);
  assert.match(out, /Tras actualizar la rama/);
  assert.match(out, /building/);
  assert.doesNotMatch(out, /Aprobar|Pedir cambios|Rechazar/);
});

test("la portada de una tarea sin criterio o con el texto borrado lo dice, sin inventar", () => {
  const empty = { ...COVER, criteria: null };
  assert.match(
    html({ ...base, state: "draft", review: reviewFrom({ status: "ok", task: empty }, undefined) }),
    /Falta el criterio de aceptación/,
  );
  const erased = { ...COVER, title: null, titleErased: true, criteria: null, criteriaErased: true };
  const out = html({
    ...base,
    state: "draft",
    review: reviewFrom({ status: "ok", task: erased }, undefined),
  });
  assert.equal((out.match(/\[borrado\]/g) ?? []).length, 2);
});

test("el texto del daemon se pinta como texto, nunca como HTML", () => {
  const evil = { ...COVER, title: "<img src=x onerror=alert(1)>", criteria: "<script>1</script>" };
  const out = html({
    ...base,
    state: "draft",
    review: reviewFrom({ status: "ok", task: evil }, undefined),
  });
  assert.doesNotMatch(out, /<img|<script/);
  assert.match(out, /&lt;img/);
});

test("el aviso del último intento se ve como un estado para lectores de pantalla", () => {
  const out = html({ ...base, notice: PLAN_CHANGED, review: reviewFrom(okTask, okPlan) });
  assert.match(
    out,
    /role="status"[^>]*class="notebook-notice"|class="notebook-notice"[^>]*role="status"/,
  );
  assert.match(out, /El plan cambió/);
  assert.doesNotMatch(html({ ...base, review: reviewFrom(okTask, okPlan) }), /notebook-notice/);
});

test("el aviso tiene estilo propio con los tokens", () => {
  assert.match(css, /\.notebook-notice \{[^}]*var\(--/);
});
