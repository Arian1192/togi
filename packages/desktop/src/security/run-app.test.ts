import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..", "..");

test("el script app compila la interfaz y arranca con el protocolo que la empaqueta", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const app = pkg.scripts.app ?? "";
  assert.match(app, /^vite build && cargo run /);
  assert.match(app, /--features tauri\/custom-protocol/);
});

test("el README explica cómo arrancar la app y el error de cargo run a secas", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.match(readme, /pnpm --filter @togi\/desktop app/);
  assert.match(readme, /asset not found: index\.html/);
  assert.match(readme, /tauri\/custom-protocol/);
});
