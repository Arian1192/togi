import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityTimeline } from "./ActivityTimeline.ts";
import type { ActivityItem, ActivityResult } from "./activityApi.ts";

// La vista de la línea de tiempo de Actividad (ADR-010 §3): líneas con aro para los estados y una
// misma tarjeta para cada aportación. Solo nodos de texto (§8) y clases, sin colores escritos.

const now = Date.parse("2026-11-11T09:30:12.000Z");
const at = "2026-11-11T09:30:00.000Z";
const togi = { kind: "system", component: "adapter:builder" } as const;
const item = (seq: number, type: ActivityItem["type"], extra: Partial<ActivityItem> = {}) =>
  ({ seq, at, type, actor: togi, ...extra }) as ActivityItem;
const ok = (items: ActivityItem[], truncated = false): ActivityResult => ({
  status: "ok",
  items,
  truncated,
});
const html = (result: ActivityResult | null) =>
  renderToStaticMarkup(createElement(ActivityTimeline, { result, now }));

test("el cambio de estado es una línea con su aro del color del estado y a quién se la entregó", () => {
  const out = html(
    ok([
      item(1, "decision.recorded", { actor: { kind: "human" }, verdict: "approve" }),
      item(2, "session.started", { role: "builder", sessionId: "s1" }),
    ]),
  );
  assert.match(
    out,
    /<div class="mc-st"><span class="mc-ring tone-agent" aria-hidden="true"><\/span><span><b>tú<\/b> → <b>building<\/b><\/span><span class="mc-t">hace 12 s<\/span><span class="mc-sub">↳ togi se la entregó a <span class="mc-who"><span class="mc-ava">C<\/span>Constructor<\/span><\/span><\/div>/,
  );
});

test("la sesión es una tarjeta con el rol, la hora, el especialista, el runtime, el modelo y el uso", () => {
  const out = html(
    ok([
      item(1, "session.started", {
        role: "planner",
        specialist: "generic-planner@2",
        runtime: "claude-agent-sdk@1",
        model: "claude-sonnet-5-5",
        sessionId: "s1",
      }),
      item(2, "session.ended", {
        sessionId: "s1",
        outcome: "failed",
        failureReason: "timeout",
        usage: { durationMs: 240_000, inputTokens: 1000, outputTokens: 500, estimatedCostUsd: 0.1 },
      }),
    ]),
  );
  assert.match(
    out,
    /<article class="mc-card"><div class="mc-hd"><span class="mc-ava">P<\/span><b>Planificador<\/b><span class="mc-t">hace 12 s<\/span><\/div><div class="mc-runline"><span>generic-planner@2<\/span><span>claude-agent-sdk@1<\/span><span class="is-model">claude-sonnet-5-5<\/span><\/div>/,
  );
  assert.match(out, /<p class="mc-note">failed · timeout<\/p>/);
  assert.match(
    out,
    /<div class="mc-usage"><span>4 min<\/span><span>2k tokens<\/span><span>\$0,10<\/span><\/div>/,
  );
});

test("una sesión que terminó bien no lleva nota, y una abierta no lleva uso", () => {
  const out = html(
    ok([
      item(1, "session.started", { role: "planner", sessionId: "s1" }),
      item(2, "session.ended", { sessionId: "s1", outcome: "completed" }),
      item(3, "session.started", { role: "builder", sessionId: "s2" }),
    ]),
  );
  assert.doesNotMatch(out, /mc-note|mc-usage|mc-runline/);
});

test("la verificación lleva el monograma de togi, sin modelo, y sus gates con lo que salió", () => {
  const out = html(
    ok([
      item(1, "gate.completed", { cycle: 1, gate: "lint", status: "pass" }),
      item(2, "gate.completed", { cycle: 1, gate: "test", status: "fail" }),
      item(3, "verification.completed", { cycle: 1, headSha: "a3f9c21", passed: false }),
    ]),
  );
  assert.match(
    out,
    /<article class="mc-card"><div class="mc-hd"><span class="mc-ava is-togi">t<\/span><b>togi<\/b><span class="mc-m">verificó el ciclo 1<\/span><span class="mc-t">hace 12 s<\/span><\/div><div class="mc-runline"><span>sin modelo · determinista<\/span><\/div>/,
  );
  assert.match(
    out,
    /<code class="ident">a3f9c21<\/code><span class="mc-grow">1 de 2 gates<\/span><span class="mc-verdict tone-human">no pasa<\/span>/,
  );
  assert.match(
    out,
    /<div class="mc-chk"><span class="is-pass">lint<\/span><span class="is-fail">test · fail<\/span><\/div>/,
  );
});

test("una verificación que pasa lo dice en el tono de terminado", () => {
  const out = html(
    ok([
      item(1, "gate.completed", { cycle: 1, gate: "lint", status: "pass" }),
      item(2, "verification.completed", { cycle: 1, passed: true }),
    ]),
  );
  assert.match(
    out,
    /<span class="mc-grow">1 de 1 gates<\/span><span class="mc-verdict tone-done">pasa<\/span>/,
  );
});

test("mientras corren los gates, la verificación está en curso", () => {
  const out = html(ok([item(1, "gate.completed", { cycle: 2, gate: "lint", status: "error" })]));
  assert.match(out, /verificando el ciclo 2/);
  assert.match(out, /<span class="mc-verdict tone-agent">en curso<\/span>/);
  assert.match(out, /<span class="is-error">lint · error<\/span>/);
});

test("lo que trae el agente va como texto, nunca como HTML", () => {
  const out = html(ok([item(1, "session.started", { role: "planner", model: "<img src=x>" })]));
  assert.match(out, /&lt;img src=x&gt;/);
  assert.doesNotMatch(out, /<img/);
});

test("leyendo, sin movimientos, con los antiguos cortados o sin poder leer: una frase corta", () => {
  assert.match(html(null), /<p class="muted">Leyendo la actividad…<\/p>/);
  assert.match(html(ok([])), /<p class="muted">Todavía no hay movimientos\.<\/p>/);
  assert.match(
    html(ok([item(1, "task.submitted")], true)),
    /<p class="muted">Faltan los movimientos más antiguos\.<\/p><div class="mc">/,
  );
  const down = html({ status: "unreachable", reason: "app" });
  assert.equal(down, '<p class="muted">No se pudo leer la actividad de la tarea.</p>');
});
