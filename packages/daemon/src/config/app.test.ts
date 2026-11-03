import assert from "node:assert/strict";
import { test } from "node:test";
import { APP, HOME_ENV, paths, resolveHome } from "./app.ts";

test("resolveHome usa TOGI_HOME si está definida", () => {
  assert.equal(HOME_ENV, "TOGI_HOME");
  assert.equal(resolveHome({ TOGI_HOME: "/tmp/x" }, "/home/u"), "/tmp/x");
});

test("resolveHome cae en ~/.togi", () => {
  assert.equal(resolveHome({}, "/home/u"), "/home/u/.togi");
});

test("paths cuelga todo de la raíz y del nombre de la app", () => {
  const p = paths("/r");
  assert.equal(p.database, `/r/${APP.name}.db`);
  assert.equal(p.socket, `/r/run/${APP.name}.sock`);
  assert.equal(p.credentials, "/r/credentials");
});
