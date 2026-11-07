import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type PlanData, PlanNotebook, type TaskCover } from "./PlanNotebook.ts";

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
const html = (t = task(), p = plan()) =>
  renderToStaticMarkup(createElement(PlanNotebook, { task: t, plan: p }));

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

test("hay tres secciones numeradas con kanji, en orden", () => {
  const sections = [
    ...html().matchAll(/<h2><span class="kanji" aria-hidden="true">(.)<\/span>([^<]+)<\/h2>/g),
  ];
  assert.deepEqual(
    sections.map((m) => [m[1], m[2]]),
    [
      ["一", "El enfoque"],
      ["二", "Los ficheros"],
      ["三", "El tamaño"],
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

test("la vista de lectura no trae botones: la decisión es de la parte siguiente", () => {
  assert.doesNotMatch(html(), /<button/);
});
