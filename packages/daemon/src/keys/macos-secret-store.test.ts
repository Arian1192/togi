import assert from "node:assert/strict";
import { test } from "node:test";
import { type Exec, keychainAccount } from "./macos-keychain.ts";
import { MacosSecretStore } from "./macos-secret-store.ts";

const SECRET = "sk-ant-test-0123456789";
const failWith = (code: unknown) => Object.assign(new Error(`exit ${String(code)}`), { code });

function recorder(respond: () => string = () => "") {
  const calls: { args: string[]; stdin?: string }[] = [];
  const exec: Exec = async (_file, args, stdin) => {
    calls.push({ args, ...(stdin === undefined ? {} : { stdin }) });
    return respond();
  };
  return { exec, calls };
}

test("set manda el secreto por stdin con -U y nunca en los argumentos", async () => {
  const { exec, calls } = recorder();
  await new MacosSecretStore("/h", exec).set("api-key", SECRET);
  assert.deepEqual(calls[0]?.args, ["-i"]);
  assert.match(calls[0]?.stdin ?? "", /^add-generic-password -U /);
  assert.ok(calls[0]?.stdin?.includes(SECRET));
  assert.ok(calls[0]?.stdin?.includes(`-a ${keychainAccount("/h")}`));
  assert.ok(calls[0]?.stdin?.includes("-s togi-agent-api-key"));
});

test("las entradas no son la de la clave maestra y cada modo tiene la suya", async () => {
  const { exec, calls } = recorder();
  const store = new MacosSecretStore("/h", exec);
  await store.set("api-key", SECRET);
  await store.set("subscription", SECRET);
  const services = calls.map((c) => /-s (\S+)/.exec(c.stdin ?? "")?.[1]);
  assert.deepEqual(services, ["togi-agent-api-key", "togi-agent-subscription-token"]);
});

test("un secreto con comillas, espacios o saltos de línea lanza sin ejecutar nada", async () => {
  const { exec, calls } = recorder();
  const store = new MacosSecretStore("/h", exec);
  for (const bad of ['a"b', "a'b", "a\\b", "a b", "a\nb", ""]) {
    await assert.rejects(
      store.set("api-key", bad),
      (e: Error) => !e.message.includes(bad.trim() || "\u0000"),
    );
  }
  assert.equal(calls.length, 0);
});

test("has no pide el secreto (sin -w)", async () => {
  const { exec, calls } = recorder();
  assert.equal(await new MacosSecretStore("/h", exec).has("subscription"), true);
  assert.ok(!calls[0]?.args.includes("-w"));
});

test("get lee con -w; solo el código 44 es ausente; delete tolera ausente", async () => {
  const ok = recorder(() => `${SECRET}\n`);
  assert.equal(await new MacosSecretStore("/h", ok.exec).get("api-key"), SECRET);
  assert.ok(ok.calls[0]?.args.includes("-w"));
  const absent = recorder(() => {
    throw failWith(44);
  });
  const store = new MacosSecretStore("/h", absent.exec);
  assert.equal(await store.get("api-key"), null);
  assert.equal(await store.has("api-key"), false);
  await store.delete("api-key");
  const bad = recorder(() => {
    throw failWith(1);
  });
  await assert.rejects(new MacosSecretStore("/h", bad.exec).has("api-key"), { code: 1 });
  await assert.rejects(new MacosSecretStore("/h", bad.exec).delete("api-key"), { code: 1 });
});
