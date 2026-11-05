import assert from "node:assert/strict";
import { test } from "node:test";
import { FileSecretStore } from "./file-secret-store.ts";
import { MacosSecretStore } from "./macos-secret-store.ts";
import { selectSecretStore } from "./select-keychain.ts";

test("darwin elige el Llavero y TOGI_KEYCHAIN=file el fichero", () => {
  assert.ok(
    selectSecretStore({ home: "/h", platform: "darwin", env: {} }) instanceof MacosSecretStore,
  );
  const env = { TOGI_KEYCHAIN: "file" };
  assert.ok(selectSecretStore({ home: "/h", platform: "linux", env }) instanceof FileSecretStore);
});

test("otras plataformas fallan sin caer al fichero", () => {
  assert.throws(
    () => selectSecretStore({ home: "/h", platform: "linux", env: {} }),
    /plataforma "linux"/,
  );
});
