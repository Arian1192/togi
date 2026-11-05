import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePlanOutput } from "./plan-output.ts";

const valid = {
  files: [{ path: "packages/core/src/a.ts", change: "modify" }],
  newTests: ["packages/core/src/a.test.ts"],
  approach: "Añadir la función y sus tests.",
  estimatedLines: { production: 80, tests: 120 },
};
const json = JSON.stringify(valid);
const invalid = (text: string) => {
  const result = parsePlanOutput(text);
  assert.equal(result.ok, false, text);
  return result.ok ? "" : result.error;
};

test("acepta el JSON solo, en un bloque ```json o con texto alrededor", () => {
  for (const text of [
    json,
    `\`\`\`json\n${json}\n\`\`\``,
    `Aquí va:\n\`\`\`\n${json}\n\`\`\`\nFin.`,
  ]) {
    const result = parsePlanOutput(text);
    assert.ok(result.ok, text);
    assert.deepEqual(result.ok && result.plan, valid);
  }
});

test("si hay varios bloques, vale el último", () => {
  const text = `\`\`\`json\n{"files": 1}\n\`\`\`\n\`\`\`json\n${json}\n\`\`\``;
  assert.ok(parsePlanOutput(text).ok);
});

test("rechaza texto que no es JSON", () => {
  assert.match(invalid("no hay plan"), /JSON/);
  assert.match(invalid(""), /JSON/);
});

test("rechaza un campo de más, uno de menos y un valor fuera de la lista", () => {
  assert.match(invalid(JSON.stringify({ ...valid, baseSha: "abc" })), /baseSha/);
  const { approach: _a, ...sinEnfoque } = valid;
  assert.match(invalid(JSON.stringify(sinEnfoque)), /approach/);
  const change = { ...valid, files: [{ path: "a.ts", change: "rename" }] };
  assert.match(invalid(JSON.stringify(change)), /change/);
  assert.match(invalid(JSON.stringify({ ...valid, approach: "" })), /approach/);
});

test("rechaza rutas fuera del repo y líneas negativas", () => {
  for (const path of ["../fuera", "/etc/passwd", "a/../b", "a\\b"]) {
    const plan = { ...valid, files: [{ path, change: "add" }] };
    assert.match(invalid(JSON.stringify(plan)), /files/, path);
  }
  const lines = { ...valid, estimatedLines: { production: -1, tests: 0 } };
  assert.match(invalid(JSON.stringify(lines)), /estimatedLines/);
});

test("el error se acota aunque el agente invente muchas claves", () => {
  const plan = {
    ...valid,
    ...Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, 1])),
  };
  assert.ok(invalid(JSON.stringify(plan)).length <= 1000);
});
