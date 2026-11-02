import assert from "node:assert/strict";
import { test } from "node:test";
import * as core from "@forja/core";

test("daemon resuelve @forja/core con type stripping", () => {
  assert.equal(typeof core, "object");
});
