import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_BRANCH_MAX, CreateTask } from "./schemas.ts";

const create = (baseBranch: string) =>
  CreateTask.safeParse({ title: "Añadir filtro", risk: "low", repo: "o/r", baseBranch });
const accepts = (b: string) => assert.equal(create(b).success, true, JSON.stringify(b));
const rejects = (b: string) => assert.equal(create(b).success, false, JSON.stringify(b));

test("baseBranch admite ramas normales y mantiene el valor por defecto", () => {
  for (const b of ["dev", "main", "release/1.2", "feature/mi_rama-2", "v1.0.0", "a.b"]) accepts(b);
  assert.equal(
    CreateTask.parse({ title: "Añadir filtro", risk: "low", repo: "o/r" }).baseBranch,
    "dev",
  );
});

test("baseBranch no puede estar vacío", () => rejects(""));

test("baseBranch solo admite letras, números, punto, guion bajo, barra y guion", () => {
  for (const b of [
    "con espacio",
    "a;b",
    "a$(x)",
    "a\nb",
    "ñandú",
    "a~1",
    "a^",
    "a:b",
    "a?b",
    "a*",
    "a\\b",
  ]) {
    rejects(b);
  }
});

test("baseBranch no puede empezar por - ni por /", () => {
  for (const b of ["-f", "--force", "--upload-pack=x", "/dev", "/"]) rejects(b);
});

test("baseBranch no puede terminar en /", () => {
  for (const b of ["dev/", "a/b/"]) rejects(b);
});

test("baseBranch no puede contener ..", () => {
  for (const b of ["a..b", "..", "dev/../main", "x.."]) rejects(b);
});

test("baseBranch tiene una longitud máxima", () => {
  accepts("a".repeat(BASE_BRANCH_MAX));
  rejects("a".repeat(BASE_BRANCH_MAX + 1));
});
