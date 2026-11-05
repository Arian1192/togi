import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { DataClass } from "@togi/core";
import { paths } from "../config/app.ts";
import { DISCARDED, MAX_REDACT_CHARS } from "../redaction/redact.ts";
import { startDaemon } from "../start.ts";
import { RedactingBlobStore } from "./redacting-blob-store.ts";

const SECRET = ["sk-ant-", "api03-", "q".repeat(40)].join("");
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/** Guarda lo que recibe, para ver qué llegaría a cifrarse. */
function recording() {
  const seen: { text: string; dataClass: DataClass }[] = [];
  const inner = {
    async put(bytes: Uint8Array, dataClass: DataClass) {
      seen.push({ text: dec(bytes), dataClass });
      return { hash: "hmac-sha256:x" as const, keyId: "key_x", dataClass };
    },
    async get() {
      return enc("leído");
    },
    async shred() {},
  };
  return { inner, seen };
}

test("limpia trajectory, gate_evidence y prompt antes de guardar", async () => {
  const { inner, seen } = recording();
  const store = new RedactingBlobStore(inner);
  for (const dataClass of ["trajectory", "gate_evidence", "prompt"] as const) {
    await store.put(enc(`uso ${SECRET}`), dataClass, 1);
  }
  assert.deepEqual(
    seen.map((s) => s.text),
    Array(3).fill("uso [REDACTED:anthropic-api-key]"),
  );
});

test("no toca task_text ni untrusted_input (el ADR-004 no los incluye)", async () => {
  const { inner, seen } = recording();
  const store = new RedactingBlobStore(inner);
  await store.put(enc(`uso ${SECRET}`), "task_text", 1);
  await store.put(enc(`uso ${SECRET}`), "untrusted_input", 1);
  assert.ok(seen.every((s) => s.text.includes(SECRET)));
});

test("un blob demasiado grande se guarda como aviso, nunca sin limpiar", async () => {
  const { inner, seen } = recording();
  const store = new RedactingBlobStore(inner);
  await store.put(enc(`${SECRET}${"a".repeat(MAX_REDACT_CHARS)}`), "trajectory", 1);
  assert.equal(seen[0]?.text, DISCARDED);
  await store.put(new Uint8Array(MAX_REDACT_CHARS * 4 + 1), "prompt", 1);
  assert.equal(seen[1]?.text, DISCARDED);
});

test("get y shred pasan al almacén interno", async () => {
  const { inner } = recording();
  const store = new RedactingBlobStore(inner);
  assert.equal(
    dec(await store.get({ hash: "hmac-sha256:x", keyId: "k", dataClass: "prompt" })),
    "leído",
  );
  await store.shred("key_x");
});

test("el token de togi se limpia por valor exacto", async () => {
  const { inner, seen } = recording();
  await new RedactingBlobStore(inner, ["tok-literal-0123"]).put(
    enc("x tok-literal-0123 y"),
    "prompt",
    1,
  );
  assert.equal(seen[0]?.text, "x [REDACTED:togi-token] y");
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory()
      ? filesUnder(p)
      : statSync(p).size > 0
        ? [readFileSync(p, "latin1")]
        : [];
  });
}

test("en el daemon real, el secreto de un prompt no llega a disco ni se lee de vuelta", async () => {
  const home = join(mkdtempSync(join(tmpdir(), "togi-redact-")), "home");
  const daemon = await startDaemon(home, { TOGI_KEYCHAIN: "file" });
  try {
    const token = readFileSync(paths(home).credentials, "utf8").trim();
    const { blobs } = daemon;
    const ref = await blobs.put(enc(`p ${SECRET} ${token}`), "prompt", 1);
    assert.equal(dec(await blobs.get(ref)), "p [REDACTED:anthropic-api-key] [REDACTED:togi-token]");
    const disk = filesUnder(home).join("\n");
    assert.ok(!disk.includes(SECRET));
  } finally {
    await daemon.close();
  }
});
