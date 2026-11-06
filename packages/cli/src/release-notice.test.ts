import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startDaemon } from "../../daemon/src/start.ts";
import { releaseNotice } from "./release-notice.ts";
import { runCli } from "./testing/run-cli.ts";

test("versiones distintas: avisa con el comando togi update <etiqueta de la CLI>", () => {
  const text = releaseNotice("v2", "v1");
  assert.match(text ?? "", /El daemon es v1 y la CLI v2\./);
  assert.match(text ?? "", /`togi update v2`/);
});

test("la misma versión no avisa", () => {
  assert.equal(releaseNotice("v1", "v1"), undefined);
});

test("un daemon viejo sin campo release no avisa", () => {
  assert.equal(releaseNotice("v1", undefined), undefined);
});

test("con «dev» en cualquiera de los dos no avisa", () => {
  assert.equal(releaseNotice("dev", "v1"), undefined);
  assert.equal(releaseNotice("v1", "dev"), undefined);
});

test("daemon status desde el repo muestra el release en --json y no avisa", async () => {
  const root = mkdtempSync(join(tmpdir(), "togi-release-status-"));
  const home = join(root, "home");
  const daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
  try {
    const json = await runCli(["daemon", "status", "--json"], home);
    assert.equal(JSON.parse(json.stdout).release, "dev");
    const text = await runCli(["daemon", "status", "--no-color"], home);
    assert.doesNotMatch(text.stdout, /togi update/);
  } finally {
    await daemon.close();
    rmSync(root, { recursive: true, force: true });
  }
});
