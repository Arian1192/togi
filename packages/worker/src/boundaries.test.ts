import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SRT = "@anthropic-ai/sandbox-runtime";
const packages = join(import.meta.dirname, "..", "..");

for (const name of ["core", "daemon"]) {
  test(`${name} no depende de srt ni lo importa`, () => {
    const dir = join(packages, name);
    const pkg = readFileSync(join(dir, "package.json"), "utf8");
    assert.ok(!pkg.includes(SRT), `${name}/package.json`);
    const files = readdirSync(join(dir, "src"), { recursive: true, encoding: "utf8" });
    for (const f of files.filter((f) => f.endsWith(".ts"))) {
      assert.ok(!readFileSync(join(dir, "src", f), "utf8").includes(SRT), `${name}/${f}`);
    }
  });
}
