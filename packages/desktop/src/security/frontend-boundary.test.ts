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

test("el frontend solo invoca los comandos del estado del daemon y de la lista de tareas", () => {
  const invoked = sources.flatMap(({ text }) =>
    [...text.matchAll(/invoke(?:<[^>]*>)?\(\s*"([^"]+)"/g)].map((m) => m[1]),
  );
  assert.deepEqual(invoked, ["get_daemon_status", "list_tasks"]);
});

test("la página no tiene recursos remotos ni scripts en línea", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  assert.doesNotMatch(html, /(src|href)\s*=\s*["'](https?:)?\/\//i);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/i);
});
