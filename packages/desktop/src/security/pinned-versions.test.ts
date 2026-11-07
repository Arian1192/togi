import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

// Las dependencias externas, en versión exacta; los paquetes del monorrepo (@togi/…), con workspace:*.
const isPinned = (name: string, version: string) =>
  name.startsWith("@togi/") ? version === "workspace:*" : /^\d+\.\d+\.\d+$/.test(version);

test("package.json usa versiones exactas, sin ^ ni ~ ni rangos, y workspace:* solo en @togi/…", () => {
  const pkg = JSON.parse(read("package.json")) as Record<string, Record<string, string>>;
  const deps = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.ok(deps.length > 0);
  for (const [name, version] of deps) assert.ok(isPinned(name, version), `${name}: ${version}`);
});

test("workspace:* solo se admite en @togi/…; las externas exigen versión exacta", () => {
  assert.ok(isPinned("@togi/core", "workspace:*"));
  assert.ok(isPinned("react", "19.3.1"));
  assert.ok(!isPinned("react", "workspace:*"));
  assert.ok(!isPinned("react", "^19.3.1"));
  assert.ok(!isPinned("@togi/core", "^0.0.0"));
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
