import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { confirm } from "./confirm.ts";

const ask = async (typed: string | null) => {
  const input = new PassThrough();
  const output = new PassThrough();
  const result = confirm("¿Seguro?", { input, output });
  if (typed === null) input.end();
  else input.end(`${typed}\n`);
  return { yes: await result, shown: output.read()?.toString() };
};

test("s, sí, y y yes confirman", async () => {
  for (const a of ["s", "SI", "sí", "y", "Yes"]) assert.equal((await ask(a)).yes, true, a);
});

test("n, vacío, otra cosa y fin de entrada cancelan", async () => {
  for (const a of ["n", "", "quizá", null]) assert.equal((await ask(a)).yes, false, String(a));
});

test("la pregunta se escribe en la salida inyectada", async () => {
  assert.equal((await ask("s")).shown, "¿Seguro? ");
});
