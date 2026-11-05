import assert from "node:assert/strict";
import { test } from "node:test";
import type { CredentialMode, SecretStore } from "../keys/secret-store.ts";
import { agentCredentials, InconsistentCredentialsError } from "./agent-credential.ts";

const KEY = "sk-ant-key-0123456789";
const TOKEN = "oauth-token-0123456789";

class MemoryStore implements SecretStore {
  readonly data = new Map<CredentialMode, string>();
  failDelete = false;
  async has(m: CredentialMode) {
    return this.data.has(m);
  }
  async get(m: CredentialMode) {
    return this.data.get(m) ?? null;
  }
  async set(m: CredentialMode, s: string) {
    this.data.set(m, s);
  }
  async delete(m: CredentialMode) {
    if (this.failDelete) throw new Error(`boom ${KEY}`);
    this.data.delete(m);
  }
}

test("sin credencial: status null y read null", async () => {
  const c = agentCredentials(new MemoryStore());
  assert.equal(await c.status(), null);
  assert.equal(await c.read(), null);
});

test("cambiar de modo sustituye la anterior", async () => {
  const store = new MemoryStore();
  const c = agentCredentials(store);
  await c.set("api-key", KEY);
  assert.equal(await c.status(), "api-key");
  await c.set("subscription", TOKEN);
  assert.equal(await c.status(), "subscription");
  assert.deepEqual([...store.data.keys()], ["subscription"]);
  await c.set("subscription", `${TOKEN}-2`);
  assert.equal(store.data.get("subscription"), `${TOKEN}-2`);
});

test("read entrega la variable y el secreto de cada modo", async () => {
  const c = agentCredentials(new MemoryStore());
  await c.set("api-key", KEY);
  assert.deepEqual(await c.read(), { mode: "api-key", envName: "ANTHROPIC_API_KEY", secret: KEY });
  await c.set("subscription", TOKEN);
  assert.deepEqual(await c.read(), {
    mode: "subscription",
    envName: "CLAUDE_CODE_OAUTH_TOKEN",
    secret: TOKEN,
  });
});

test("si falla el borrado quedan las dos: error claro, status inconsistente y nunca elige modo", async () => {
  const store = new MemoryStore();
  const c = agentCredentials(store);
  await c.set("api-key", KEY);
  store.failDelete = true;
  await assert.rejects(c.set("subscription", TOKEN), (e: Error) => {
    assert.ok(e instanceof InconsistentCredentialsError);
    assert.ok(!e.message.includes(KEY) && !e.message.includes(TOKEN));
    return true;
  });
  assert.equal(await c.status(), "inconsistent");
  await assert.rejects(c.read(), InconsistentCredentialsError);
  store.failDelete = false;
  await c.set("subscription", TOKEN);
  assert.equal(await c.status(), "subscription");
});
