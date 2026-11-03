import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { resolveEditor, runEditor } from "./commands/editor.ts";
import type { CliError } from "./errors.ts";

let root: string;
before(() => {
  root = mkdtempSync(join(tmpdir(), "togi-editor-test-"));
});
after(() => rmSync(root, { recursive: true, force: true }));

const script = (name: string, body: string): string[] => {
  const path = join(root, name);
  writeFileSync(path, body);
  return [process.execPath, path];
};

test("resolveEditor prefiere VISUAL, separa por espacios y devuelve undefined sin editor", () => {
  assert.deepEqual(resolveEditor({ VISUAL: "code -w", EDITOR: "vi" }), ["code", "-w"]);
  assert.deepEqual(resolveEditor({ VISUAL: "  ", EDITOR: "vi" }), ["vi"]);
  assert.equal(resolveEditor({}), undefined);
});

test("un editor que sale con 1 lanza editor_failed (1) y no deja el fichero", async () => {
  const record = join(root, "exit1.json");
  const editor = script(
    "exit1.js",
    `require("node:fs").writeFileSync(${JSON.stringify(record)}, process.argv[2]); process.exit(1);`,
  );
  const error = (await runEditor(editor, "x").catch((e: CliError) => e)) as CliError;
  assert.deepEqual([error.code, error.exitCode, error.context.detail], ["editor_failed", 1, "1"]);
  assert.equal(existsSync(readFileSync(record, "utf8")), false);
});

test("el fichero es 0600 en una carpeta 0700, devuelve lo escrito y no queda después", async () => {
  const record = join(root, "modes.json");
  const editor = script(
    "modes.js",
    `const fs = require("node:fs"); const path = require("node:path");
const file = process.argv[2];
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({
  file, file_mode: fs.statSync(file).mode & 0o777, dir_mode: fs.statSync(path.dirname(file)).mode & 0o777,
}));
fs.writeFileSync(file, "editado\\n");`,
  );
  assert.equal(await runEditor(editor, "original"), "editado\n");
  const seen = JSON.parse(readFileSync(record, "utf8"));
  assert.deepEqual([seen.file_mode, seen.dir_mode], [0o600, 0o700]);
  assert.equal(existsSync(seen.file), false);
  assert.equal(existsSync(join(seen.file, "..")), false);
});

test("SIGTERM mientras el editor corre borra el fichero y la carpeta", async () => {
  const marker = join(root, "slow.json");
  const slow = script(
    "slow.js",
    `require("node:fs").writeFileSync(${JSON.stringify(marker)}, process.argv[2]); setInterval(() => {}, 1000);`,
  );
  const runner = join(root, "runner.mjs");
  writeFileSync(
    runner,
    `import { runEditor } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "commands", "editor.ts")).href)};
await runEditor(${JSON.stringify(slow)}, "secreto");`,
  );
  const child = spawn(process.execPath, [runner], { stdio: "ignore" });
  const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
  for (let i = 0; i < 100 && !existsSync(marker); i++) await new Promise((r) => setTimeout(r, 50));
  const file = readFileSync(marker, "utf8");
  assert.equal(existsSync(file), true);
  child.kill("SIGTERM");
  assert.equal(await closed, 143);
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(join(file, "..")), false);
});
