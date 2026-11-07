import assert from "node:assert/strict";
import { test } from "node:test";
import { REASON_CATEGORIES } from "@togi/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type PlanData, PlanNotebook, ReasonForm, type TaskCover } from "./PlanNotebook.ts";
import type { FormState } from "./planDecision.ts";

const task = (extra: Partial<TaskCover> = {}): TaskCover => ({
  number: 12,
  title: "Añadir filtro por fecha",
  titleErased: false,
  risk: "low",
  repo: "arian1192/togi",
  criteria: "El filtro acepta un rango de fechas.",
  criteriaErased: false,
  ...extra,
});
const plan = (extra: Partial<PlanData> = {}): PlanData => ({
  planVersion: 2,
  files: [
    { path: "src/a.ts", change: "modify" },
    { path: "src/b.ts", change: "add" },
    { path: "src/c.ts", change: "delete" },
  ],
  newTests: ["src/a.test.ts"],
  approach: "Primero A.\nLuego B.",
  approachErased: false,
  estimatedLines: { production: 40, tests: 90 },
  ...extra,
});
const html = (t = task(), p = plan(), busy = false) =>
  renderToStaticMarkup(createElement(PlanNotebook, { task: t, plan: p, busy, onDecide: () => {} }));
const count = (out: string, re: RegExp) => (out.match(re) ?? []).length;

test("la portada lleva la línea de contexto en mono, el título y el criterio como entradilla", () => {
  assert.match(
    html(),
    /<p class="notebook-context">arian1192\/togi · #12 · riesgo bajo · plan v2<\/p><h1>Añadir filtro por fecha<\/h1><p class="notebook-lede">El filtro acepta un rango de fechas\.<\/p>/,
  );
});

test("un título o criterio borrado o ausente se ve con un marcador, no se oculta", () => {
  assert.match(
    html(task({ titleErased: true, title: null })),
    /<h1 class="muted">\[borrado\]<\/h1>/,
  );
  assert.match(html(task({ criteriaErased: true, criteria: null })), /lede muted">\[borrado\]</);
  assert.match(html(task({ criteria: "  " })), /lede muted">Falta el criterio de aceptación\./);
  assert.match(html(task({ risk: "raro" })), /riesgo desconocido/);
});

test("hay cuatro secciones numeradas con kanji, en orden", () => {
  const sections = [
    ...html().matchAll(/<h2><span class="kanji" aria-hidden="true">(.)<\/span>([^<]+)<\/h2>/g),
  ];
  assert.deepEqual(
    sections.map((m) => [m[1], m[2]]),
    [
      ["一", "El enfoque"],
      ["二", "Los ficheros"],
      ["三", "El tamaño"],
      ["四", "La decisión"],
    ],
  );
});

test("el título, el criterio, el enfoque y las rutas salen como texto: el HTML no se interpreta", () => {
  const approach = "<script>alert(1)</script><img src=x onerror=alert(2)>\n  &amp; <b>negrita</b>";
  const out = html(
    task({ title: "<b>x</b>", criteria: "<i>y</i>" }),
    plan({ approach, files: [{ path: "<u>p</u>.ts", change: "add" }] }),
  );
  assert.match(
    out,
    /&lt;script&gt;alert\(1\)&lt;\/script&gt;&lt;img src=x onerror=alert\(2\)&gt;\n {2}&amp;amp; &lt;b&gt;negrita&lt;\/b&gt;/,
  );
  assert.doesNotMatch(out, /<script|<img|<b>|<i>|<u>/);
  assert.match(out, /<h1>&lt;b&gt;x&lt;\/b&gt;<\/h1>/);
  assert.match(out, /<p class="notebook-lede">&lt;i&gt;y&lt;\/i&gt;<\/p>/);
});

test("un enfoque borrado se ve con su marcador", () => {
  const out = html(task(), plan({ approachErased: true, approach: "no se usa" }));
  assert.match(out, /notebook-approach muted">\[borrado\]</);
  assert.doesNotMatch(out, /no se usa/);
});

test("los ficheros llevan su signo y los tests nuevos van aparte", () => {
  const out = html();
  assert.match(out, /<span class="sign">~<\/span><code>src\/a\.ts<\/code>/);
  assert.match(out, /<span class="sign">\+<\/span><code>src\/b\.ts<\/code>/);
  assert.match(out, /<span class="sign">−<\/span><code>src\/c\.ts<\/code>/);
  assert.match(
    out,
    /Tests nuevos<\/p><ul class="notebook-files"><li><span class="sign">\+<\/span><code>src\/a\.test\.ts/,
  );
  assert.match(html(task(), plan({ newTests: [] })), /Sin tests nuevos\./);
  assert.match(
    html(task(), plan({ files: [{ path: "x", change: "rename" }] })),
    /<span class="sign">\?<\/span>/,
  );
});

test("el tamaño muestra los números y sus límites", () => {
  assert.match(html(), /producción 40 de 200 · tests 90 · total 130 de 500/);
});

test("sin decidir hay un único botón principal, con verbo, y dos secundarios", () => {
  const out = html();
  assert.equal(count(out, /btn btn-primary/g), 1);
  assert.match(out, /btn btn-primary">Aprobar el plan</);
  assert.match(out, /btn btn-secondary">Pedir cambios</);
  assert.match(out, /btn btn-secondary">Rechazar el plan</);
  assert.equal(count(out, /disabled/g), 0);
});

test("un plan que pasa de los límites no se puede aprobar y dice por qué al lado", () => {
  const out = html(task(), plan({ estimatedLines: { production: 250, tests: 10 } }));
  assert.match(
    out,
    /No se puede aprobar: el plan supera las 200 líneas de producción\. Pide cambios o rechaza\./,
  );
  assert.match(out, /<button type="button" class="btn btn-primary" disabled="">Aprobar el plan</);
  assert.equal(count(out, /disabled/g), 1);
});

test("ocupado, todos los botones se desactivan", () => {
  assert.equal(count(html(task(), plan(), true), /disabled=""/g), 3);
});

const form = (state: FormState) =>
  renderToStaticMarkup(
    createElement(ReasonForm, { state, busy: false, dispatch: () => {}, onSubmit: () => {} }),
  );

test("el formulario ofrece las categorías de core y el verbo de cada decisión", () => {
  const out = form({ kind: "reject", category: "", text: "" });
  const options = [...out.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(options, ["", ...REASON_CATEGORIES]);
  assert.match(out, /btn btn-primary" disabled="">Rechazar el plan</);
  assert.equal(count(out, /btn btn-primary/g), 1);
  assert.match(out, /btn btn-secondary">Cancelar</);
  assert.match(form({ kind: "request_changes", category: "", text: "" }), />Enviar los cambios</);
});

test("el botón del formulario se activa con un motivo válido", () => {
  const out = form({ kind: "request_changes", category: "logic", text: "no cubre el caso vacío" });
  assert.match(out, /<button type="button" class="btn btn-primary">Enviar los cambios</);
  assert.match(out, /<textarea[^>]*maxLength="5000"/);
  assert.match(out, /<option value="logic" selected="">Lógica</);
});
