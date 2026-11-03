import assert from "node:assert/strict";
import { test } from "node:test";
import { CreateTask } from "./schemas.ts";

const create = (repo: string) =>
  CreateTask.safeParse({ title: "Añadir filtro", risk: "low", repo });
const accepts = (r: string) => assert.equal(create(r).success, true, JSON.stringify(r));
const rejects = (r: string) => assert.equal(create(r).success, false, JSON.stringify(r));

test("repo admite owner/repo con letras, números, punto, guion bajo y guion", () => {
  for (const r of ["Arian1192/promos", "o/r", "a-b/c.d", "my_org/my-repo.js", "9/9", "_a/_b"]) {
    accepts(r);
  }
});

test("repo necesita exactamente owner/repo", () => {
  for (const r of ["", "sin-barra", "a/b/c", "/r", "o/", "a b/c", "o/r;x", "ñ/r"]) rejects(r);
});

test("ninguna parte de repo puede empezar por -", () => {
  for (const r of ["-x/y", "o/-y", "--upload-pack=x/y", "o/--force"]) rejects(r);
});

test("ninguna parte de repo puede empezar por .", () => {
  for (const r of [".x/y", "o/.y", ".git/y", "o/.hidden"]) rejects(r);
});

test("ninguna parte de repo puede ser . o ..", () => {
  for (const r of ["../..", "./.", "o/..", "../r", "o/.", "./r"]) rejects(r);
});
