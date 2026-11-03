import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTemplate, hasMarkerLine, parseTemplate } from "./commands/edit-template.ts";

const NONE = { title: false, description: false, acceptanceCriteria: false };
const task = (over: Partial<Parameters<typeof buildTemplate>[0]> = {}) => ({
  number: 12,
  version: 3,
  title: "Filtro por fecha",
  description: "Una línea",
  acceptanceCriteria: "Criterio",
  erased: NONE,
  ...over,
});

test("la plantilla lleva la cabecera de la guía y las tres secciones", () => {
  assert.equal(
    buildTemplate(task()),
    [
      "#togi Tarea #12 · versión 3. Las líneas que empiezan por #togi se ignoran.",
      "#togi Guarda el fichero vacío para cancelar.",
      "",
      "#togi título",
      "Filtro por fecha",
      "",
      "#togi descripción",
      "Una línea",
      "",
      "#togi criterio",
      "Criterio",
      "",
    ].join("\n"),
  );
});

test("sin tocar la plantilla, el parser devuelve lo mismo que había", () => {
  const t = task({ description: "uno\n\ndos\n  con sangría" });
  assert.deepEqual(parseTemplate(buildTemplate(t), NONE), {
    title: "Filtro por fecha",
    description: "uno\n\ndos\n  con sangría",
    acceptanceCriteria: "Criterio",
  });
});

test("los comentarios #togi se ignoran, también dentro de una sección", () => {
  const text =
    "#togi nota\n#togi título\nNuevo\n#togi otra nota\n#togi criterio\nA\n#togi fin\nB\n";
  assert.deepEqual(parseTemplate(text, NONE), { title: "Nuevo", acceptanceCriteria: "A\nB" });
});

test("el Markdown de la descripción se conserva intacto", () => {
  const md = "# Título\n\n## Subtítulo\n- punto\n\n## Descripción\ntexto\n#hashtag";
  const t = task({ description: md });
  const parsed = parseTemplate(buildTemplate(t), NONE);
  assert.equal(parsed?.description, md);
  assert.equal(parsed?.acceptanceCriteria, "Criterio");
});

test("un fichero vacío, en blanco o con solo comentarios y cabeceras cancela", () => {
  assert.equal(parseTemplate("", NONE), null);
  assert.equal(parseTemplate("\n  \n", NONE), null);
  assert.equal(parseTemplate("#togi nota\n#togi título\n\n#togi criterio\n", NONE), null);
});

test("una sección vacía vacía el campo y una que falta no se toca", () => {
  assert.deepEqual(parseTemplate("#togi título\nT\n#togi descripción\n\n", NONE), {
    title: "T",
    description: "",
  });
});

test("un campo borrado aparece como comentario, sin texto, y vacío no se toca", () => {
  const erased = { ...NONE, description: true };
  const text = buildTemplate(task({ description: null, erased }));
  assert.match(text, /#togi descripción\n#togi \[borrado\]/);
  assert.doesNotMatch(text, /Una línea/);
  assert.deepEqual(parseTemplate(text, erased), {
    title: "Filtro por fecha",
    acceptanceCriteria: "Criterio",
  });
  const written = text.replace(/(#togi \[borrado\][^\n]*\n)/, "$1Nuevo texto\n");
  assert.equal(parseTemplate(written, erased)?.description, "Nuevo texto");
});

test("un título partido en varias líneas se une con espacios y una cabecera repetida añade", () => {
  assert.deepEqual(
    parseTemplate("#togi título\nuno\n dos \n#togi criterio\nA\n#togi criterio\nB\n", NONE),
    {
      title: "uno dos",
      acceptanceCriteria: "A\nB",
    },
  );
});

test("hasMarkerLine detecta una línea #togi en cualquier texto actual", () => {
  assert.equal(hasMarkerLine(task()), false);
  assert.equal(hasMarkerLine(task({ acceptanceCriteria: "a\n#togi criterio\nb" })), true);
  assert.equal(hasMarkerLine(task({ description: null })), false);
  assert.equal(hasMarkerLine(task({ description: "  #togi no" })), false);
});
