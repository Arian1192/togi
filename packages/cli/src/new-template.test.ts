import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNewTemplate, parseNewTemplate } from "./commands/new-template.ts";

const template = (risk = "medium") =>
  buildNewTemplate({ repo: "acme/app", baseBranch: "main", risk });

test("la plantilla trae las cuatro cabeceras, el repo y la rama, y el riesgo sugerido", () => {
  const text = template();
  for (const header of ["título", "descripción", "criterio", "riesgo"]) {
    assert.match(text, new RegExp(`^#togi ${header}$`, "m"));
  }
  assert.match(text, /^#togi Tarea nueva en acme\/app → main\./m);
  assert.match(text, /^#togi riesgo\n#togi low, medium o high\.\nmedium\n$/m);
});

test("sin rama dice cuál se usa", () => {
  const text = buildNewTemplate({ repo: "o/r", baseBranch: undefined, risk: "low" });
  assert.match(text, /o\/r → la rama por defecto/);
});

test("se lee de vuelta con lo escrito en cada sección", () => {
  const text = template()
    .replace("#togi título\n", "#togi título\nExportar CSV\n")
    .replace("#togi descripción\n", "#togi descripción\nQue descargue\nlas ventas\n")
    .replace("#togi criterio\n", "#togi criterio\nDescarga un .csv\n")
    .replace("\nmedium\n", "\nhigh\n");
  assert.deepEqual(parseNewTemplate(text), {
    title: "Exportar CSV",
    description: "Que descargue\nlas ventas",
    acceptanceCriteria: "Descarga un .csv",
    risk: "high",
  });
});

test("una plantilla sin cambios, o solo con el riesgo, cancela", () => {
  assert.equal(parseNewTemplate(template()), null);
  assert.equal(parseNewTemplate(template("low")), null);
  assert.equal(parseNewTemplate(""), null);
});

test("el título partido en varias líneas se une con espacios y los comentarios no cuentan", () => {
  const text = template().replace(
    "#togi título\n",
    "#togi título\nExportar\n  CSV de ventas\n#togi un comentario mío\n",
  );
  assert.equal(parseNewTemplate(text)?.title, "Exportar CSV de ventas");
});

test("una línea con #togi dentro de un texto se trata como comentario, y # a secas es texto", () => {
  const text = template().replace(
    "#togi descripción\n",
    "#togi descripción\n# Paso 1\n#togi esto se ignora\nPaso 2\n",
  );
  assert.equal(parseNewTemplate(text)?.description, "# Paso 1\nPaso 2");
});

test("sin sección de riesgo, el riesgo queda vacío para que lo rechace la validación", () => {
  const text = "#togi título\nSolo título\n";
  assert.deepEqual(parseNewTemplate(text), {
    title: "Solo título",
    description: "",
    acceptanceCriteria: "",
    risk: "",
  });
});
