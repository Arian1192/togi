import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { startDaemon } from "../start.ts";
import { socketClient } from "../testing/socket-client.ts";

let home: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
let call: ReturnType<typeof socketClient>;
beforeEach(async () => {
  home = join(mkdtempSync(join(tmpdir(), "togi-cmd-")), "home");
  daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
  call = socketClient(home);
});
afterEach(async () => {
  await daemon.close();
  rmSync(join(home, ".."), { recursive: true, force: true });
});

test("por el socket real: las cuatro rutas de comandos y el rechazo de If-Match: *", async () => {
  const created = await call("POST", "/v1/tasks", {
    title: "Filtro",
    acceptanceCriteria: "criterio",
    risk: "low",
    repo: "o/r",
  });
  assert.equal(created.status, 201);
  assert.equal(created.etag, '"1"');

  const star = await call("PATCH", "/v1/tasks/1", { title: "Otro" }, { "if-match": "*" });
  assert.equal(star.status, 400);
  assert.equal(star.json.code, "invalid_if_match");

  const edited = await call("PATCH", "/v1/tasks/1", { title: "Otro" }, { "if-match": '"1"' });
  assert.equal(edited.status, 200);
  assert.equal(edited.json.title, "Otro");

  const submitted = await call("POST", "/v1/tasks/1/submit", undefined, { "if-match": '"2"' });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.json.state, "planning");

  const rejected = await call(
    "POST",
    "/v1/tasks/1/reject",
    { reason: { category: "other", text: "no" } },
    { "if-match": '"3"' },
  );
  assert.equal(rejected.status, 200);
  assert.equal(rejected.json.state, "rejected");
  assert.equal(rejected.etag, '"4"');
});
