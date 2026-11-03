import assert from "node:assert/strict";
import { test } from "node:test";
import { runCli } from "./testing/run-cli.ts";

// La validación ocurre antes de hablar con el daemon: con un home vacío, un 2 no puede ser un 6.
const NEW = ["task", "new", "Exportar CSV", "--risk", "low", "--repo", "o/r"];

test('--base "" y un valor que empieza por -- salen con 2 y nombran --base', async () => {
  for (const base of ["", "--force", "-x", "/dev", "a..b"]) {
    const r = await runCli([...NEW, `--base=${base}`], "/nonexistent-togi-home");
    assert.equal(r.code, 2, JSON.stringify(base));
    assert.match(r.stderr, /--base/, JSON.stringify(base));
    assert.equal(r.stdout, "");
  }
});

test("--repo con un propietario o nombre que empieza por - o . sale con 2 y nombra --repo", async () => {
  for (const repo of ["-x/y", "o/--force", ".x/y", "o/.y", "../..", "o/..", "o/.", "sin-barra"]) {
    const r = await runCli(
      ["task", "new", "Exportar CSV", "--risk", "low", `--repo=${repo}`],
      "/nonexistent-togi-home",
    );
    assert.equal(r.code, 2, JSON.stringify(repo));
    assert.match(r.stderr, /--repo/, JSON.stringify(repo));
    assert.equal(r.stdout, "");
  }
});
