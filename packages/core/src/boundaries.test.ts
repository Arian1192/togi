import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const forbidden = ["@togi/daemon", "@togi/cli"];
const pkgDir = join(import.meta.dirname, "..");

test("core no declara dependencias en daemon ni cli", () => {
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  for (const section of sections) {
    for (const name of forbidden) {
      assert.equal(pkg[section]?.[name], undefined, `${name} en ${section}`);
    }
  }
});

test("core no importa daemon ni cli", () => {
  const files = readdirSync(join(pkgDir, "src"), { recursive: true, encoding: "utf8" });
  for (const file of files.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const source = readFileSync(join(pkgDir, "src", file), "utf8");
    for (const name of forbidden) {
      assert.ok(!source.includes(name), `${file} importa ${name}`);
    }
  }
});
