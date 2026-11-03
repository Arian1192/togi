import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { open, seal } from "./aead.ts";

const key = randomBytes(32);
const plain = Buffer.from("contenido secreto");

const flip = (bytes: Uint8Array, index: number): Uint8Array => {
  const copy = Buffer.from(bytes);
  copy[index] = (copy[index] ?? 0) ^ 1;
  return copy;
};

test("cifrar dos veces lo mismo da resultados distintos y ambos se descifran", () => {
  const a = seal(key, plain, "ctx");
  const b = seal(key, plain, "ctx");
  assert.notDeepEqual(a, b);
  assert.deepEqual(open(key, a, "ctx"), plain);
  assert.deepEqual(open(key, b, "ctx"), plain);
});

test("el nonce ocupa 12 bytes y no se repite", () => {
  const a = seal(key, plain, "ctx");
  const b = seal(key, plain, "ctx");
  assert.equal(a.length, 12 + 16 + plain.length);
  assert.notDeepEqual(a.subarray(0, 12), b.subarray(0, 12));
});

test("alterar nonce, tag, ciphertext, AAD o clave hace fallar open", () => {
  const sealed = seal(key, plain, "ctx");
  for (const index of [0, 12, 28]) {
    assert.throws(() => open(key, flip(sealed, index), "ctx"), Error, `byte ${index}`);
  }
  assert.throws(() => open(key, sealed, "otro"));
  assert.throws(() => open(randomBytes(32), sealed, "ctx"));
});

test("rechaza claves de longitud incorrecta y entradas truncadas", () => {
  assert.throws(() => seal(randomBytes(16), plain, "ctx"), /32 bytes/);
  assert.throws(() => open(key, seal(key, plain, "ctx").subarray(0, 20), "ctx"), /corto/);
});
