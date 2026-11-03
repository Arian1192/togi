import assert from "node:assert/strict";
import { test } from "node:test";
import { type Exec, keychainAccount, MacosKeychain } from "./macos-keychain.ts";

const KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const HEX = Buffer.from(KEY).toString("hex");
const failWith = (code: unknown) => Object.assign(new Error(`exit ${String(code)}`), { code });

function recorder(respond: (file: string, args: string[], stdin?: string) => string) {
  const calls: { file: string; args: string[]; stdin?: string }[] = [];
  const exec: Exec = async (file, args, stdin) => {
    calls.push({ file, args, ...(stdin === undefined ? {} : { stdin }) });
    return respond(file, args, stdin);
  };
  return { exec, calls };
}

test("create manda la clave por stdin y nunca en los argumentos", async () => {
  const { exec, calls } = recorder(() => "");
  await new MacosKeychain("/h", exec).create(KEY);
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call?.file, "security");
  assert.deepEqual(call?.args, ["-i"]);
  assert.ok(call?.stdin?.includes(HEX));
  assert.ok(
    !call?.args.some((a) => a.includes(HEX) || a.includes(Buffer.from(KEY).toString("latin1"))),
  );
});

test("create no usa -U: no sobrescribe", async () => {
  const { exec, calls } = recorder(() => "");
  await new MacosKeychain("/h", exec).create(KEY);
  assert.doesNotMatch(calls[0]?.stdin ?? "", /(^|\s)-U(\s|$)/);
});

test("get usa execFile con -w, decodifica y no lleva secretos en los argumentos", async () => {
  const { exec, calls } = recorder(() => `${HEX}\n`);
  assert.deepEqual(await new MacosKeychain("/h", exec).get(), KEY);
  assert.equal(calls[0]?.file, "security");
  assert.deepEqual(calls[0]?.args.slice(0, 1), ["find-generic-password"]);
  assert.ok(calls[0]?.args.includes("-w"));
});

test("solo el código 44 significa ausente", async () => {
  const absent = recorder(() => {
    throw failWith(44);
  });
  assert.equal(await new MacosKeychain("/h", absent.exec).get(), null);
  for (const code of [1, 36, 45, 128, "ENOENT"]) {
    const bad = recorder(() => {
      throw failWith(code);
    });
    await assert.rejects(new MacosKeychain("/h", bad.exec).get(), { code });
  }
});

test("una clave guardada mal formada lanza", async () => {
  const { exec } = recorder(() => "no-es-hex\n");
  await assert.rejects(new MacosKeychain("/h", exec).get(), /32 bytes/);
});

test("un error distinto de 44 lanza en get y no se llama a create", async () => {
  const bad = recorder(() => {
    throw failWith(36);
  });
  await assert.rejects(new MacosKeychain("/h", bad.exec).get(), { code: 36 });
  assert.equal(bad.calls.length, 1);
  assert.equal(bad.calls[0]?.args[0], "find-generic-password");
});

test("create propaga el error de security (p. ej. 45, ya existe)", async () => {
  const bad = recorder(() => {
    throw failWith(45);
  });
  await assert.rejects(new MacosKeychain("/h", bad.exec).create(KEY), { code: 45 });
});

test("la cuenta incluye un hash de la ruta absoluta: cada instalación tiene su clave", () => {
  assert.notEqual(keychainAccount("/a"), keychainAccount("/b"));
  assert.equal(keychainAccount("/a/../a"), keychainAccount("/a"));
  assert.match(keychainAccount("/a"), /^togi-[0-9a-f]{12}$/);
});

test("una ruta de llavero con salto de línea, espacios o comillas lanza sin llamar a exec", async () => {
  for (const path of ["/x\ny", "/x y", '/x"y', "/x'y", "/x\\y", "/x\ty"]) {
    const { exec, calls } = recorder(() => "");
    await assert.rejects(
      new MacosKeychain("/h", exec, path).create(KEY),
      /ruta/,
      JSON.stringify(path),
    );
    assert.equal(calls.length, 0);
  }
});

test("la línea enviada a security -i lleva la ruta del llavero tal cual cuando es válida", async () => {
  const { exec, calls } = recorder(() => "");
  await new MacosKeychain("/h", exec, "/tmp/k.keychain-db").create(KEY);
  assert.match(calls[0]?.stdin ?? "", /-w [0-9a-f]{64} \/tmp\/k\.keychain-db\n$/);
});
