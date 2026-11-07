import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

test("package.json usa versiones exactas, sin ^ ni ~ ni rangos", () => {
  const pkg = JSON.parse(read("package.json")) as Record<string, Record<string, string>>;
  const versions = Object.values({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.ok(versions.length > 0);
  for (const v of versions) assert.match(v, /^\d+\.\d+\.\d+$/);
});

test("Cargo.toml fija cada dependencia con =, y rust-toolchain.toml fija la versión", () => {
  const sections = read("src-tauri", "Cargo.toml").split(/^\[(?:build-)?dependencies\]$/m);
  const lines = sections
    .slice(1)
    .flatMap((s) => s.split("\n\n")[0]?.split("\n") ?? [])
    .filter((l) => l.includes("="));
  assert.ok(lines.length >= 4);
  for (const line of lines) assert.match(line, /version\s*=\s*"=\d|=\s*"=\d/, line);
  assert.match(read("rust-toolchain.toml"), /channel\s*=\s*"\d+\.\d+\.\d+"/);
});
