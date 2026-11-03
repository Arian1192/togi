import assert from "node:assert/strict";
import { test } from "node:test";
import * as core from "@togi/core";

test("daemon resuelve @togi/core con type stripping", () => {
  assert.equal(typeof core, "object");
});
