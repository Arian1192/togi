import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMAIN_ERROR_CODES } from "@togi/core";
import { Hono } from "hono";
import { domainStatus, problem } from "./problem.ts";

test("task_not_found es 404 y el resto de reglas del flujo, 422", () => {
  for (const code of DOMAIN_ERROR_CODES) {
    assert.equal(domainStatus(code), code === "task_not_found" ? 404 : 422, code);
  }
});

test("problem responde application/problem+json con status, code y detail", async () => {
  const app = new Hono();
  app.get("/", () => problem(412, "precondition_failed", "versión vieja", { etag: '"3"' }));
  const res = await app.request("/");
  assert.equal(res.status, 412);
  assert.equal(res.headers.get("content-type"), "application/problem+json");
  assert.equal(res.headers.get("etag"), '"3"');
  assert.deepEqual(await res.json(), {
    type: "about:blank",
    title: "Precondition Failed",
    status: 412,
    code: "precondition_failed",
    detail: "versión vieja",
  });
});

test("sin detail el cuerpo no lleva la clave", async () => {
  const app = new Hono();
  app.get("/", () => problem(401, "unauthorized"));
  const body = (await (await app.request("/")).json()) as Record<string, unknown>;
  assert.equal("detail" in body, false);
  assert.equal(body.title, "Unauthorized");
});
