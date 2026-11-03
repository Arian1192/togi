import assert from "node:assert/strict";
import { test } from "node:test";
import type { Keychain } from "./keychain.ts";
import { loadOrCreateMasterKey } from "./master-key.ts";

function fakeKeychain(initial: Uint8Array | null, getError?: Error) {
  const calls = { create: 0 };
  const keychain: Keychain = {
    get: async () => {
      if (getError) throw getError;
      return initial;
    },
    create: async () => {
      calls.create++;
    },
  };
  return { keychain, calls };
}

test("devuelve la clave existente sin crear otra", async () => {
  const existing = new Uint8Array(32).fill(7);
  const { keychain, calls } = fakeKeychain(existing);
  assert.equal(await loadOrCreateMasterKey(keychain), existing);
  assert.equal(calls.create, 0);
});

test("crea una clave de 32 bytes solo si get devuelve null", async () => {
  const { keychain, calls } = fakeKeychain(null);
  const key = await loadOrCreateMasterKey(keychain);
  assert.equal(key.length, 32);
  assert.equal(calls.create, 1);
});

test("si get lanza, propaga el error y no crea ninguna clave", async () => {
  const { keychain, calls } = fakeKeychain(null, new Error("llavero bloqueado"));
  await assert.rejects(loadOrCreateMasterKey(keychain), /llavero bloqueado/);
  assert.equal(calls.create, 0);
});
