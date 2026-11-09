import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// El test del token en sí está en Rust (src-tauri/tests/token-boundary.rs). Aquí se vigila que el
// frontend no tenga forma de llegar al daemon por su cuenta y que la página no cargue nada remoto.
const ROOT = join(import.meta.dirname, "..", "..");
const SRC = join(ROOT, "src");

const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
  .map((f) => ({ file: f, text: readFileSync(join(SRC, f), "utf8") }));

test("hay fuentes del frontend que revisar", () => {
  assert.ok(sources.length >= 2);
});

test("el frontend no importa @togi/daemon ni toca el token, la red o el sistema de ficheros", () => {
  for (const { file, text } of sources) {
    assert.doesNotMatch(text, /@togi\/daemon/, file);
    assert.doesNotMatch(text, /\btoken\b|authorization|bearer/i, file);
    assert.doesNotMatch(text, /\bfetch\(|XMLHttpRequest|WebSocket|EventSource/, file);
    assert.doesNotMatch(text, /node:|@tauri-apps\/plugin-/, file);
  }
});

test("el frontend no pinta contenido como HTML", () => {
  for (const { file, text } of sources) {
    assert.doesNotMatch(text, /dangerouslySetInnerHTML|innerHTML|eval\(/, file);
  }
});

test("el frontend solo invoca los comandos del estado, las tareas, el plan y los eventos", () => {
  const invoked = sources.flatMap(({ text }) =>
    [...text.matchAll(/invoke(?:<[^>]*>)?\(\s*"([^"]+)"/g)].map((m) => m[1]),
  );
  // Como conjunto ordenado: el orden en que se leen los ficheros no es parte del contrato.
  assert.deepEqual(
    [...new Set(invoked)].sort(),
    [
      "approve_plan",
      "get_daemon_status",
      "list_tasks",
      "read_plan",
      "read_task",
      "reject_plan",
      "request_plan_changes",
      "watch_events",
    ].sort(),
  );
  assert.equal(invoked.length, new Set(invoked).size, "un comando se invoca desde dos sitios");
});

test("ningún comando se invoca por un nombre calculado: todos aparecen escritos", () => {
  for (const { file, text } of sources) {
    assert.doesNotMatch(text, /invoke(?:<[^>]*>)?\(\s*[^"\s]/, file);
  }
});

test("la página no tiene recursos remotos ni scripts en línea", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  assert.doesNotMatch(html, /(src|href)\s*=\s*["'](https?:)?\/\//i);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/i);
});
