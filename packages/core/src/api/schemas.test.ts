import assert from "node:assert/strict";
import { test } from "node:test";
import { REASON_CATEGORIES, RISK_LEVELS } from "../model/task.ts";
import { CreateTask, EditTask, RejectTask } from "./schemas.ts";

const validCreate = { title: "Añadir filtro", risk: "low", repo: "Arian1192/promos" };

test("CreateTask válido aplica los valores por defecto", () => {
  const r = CreateTask.parse(validCreate);
  assert.equal(r.description, "");
  assert.equal(r.acceptanceCriteria, "");
  assert.equal(r.baseBranch, "dev");
});

test("CreateTask rechaza entradas inválidas", () => {
  const bad = [
    { ...validCreate, title: "ab" },
    { ...validCreate, title: "x".repeat(121) },
    { ...validCreate, risk: "extreme" },
    { ...validCreate, repo: "sin-barra" },
    { ...validCreate, description: "x".repeat(20_001) },
  ];
  for (const input of bad) {
    assert.equal(CreateTask.safeParse(input).success, false, JSON.stringify(input).slice(0, 80));
  }
});

test("EditTask admite cambios parciales", () => {
  assert.equal(EditTask.safeParse({ title: "Nuevo título" }).success, true);
  assert.equal(EditTask.safeParse({ acceptanceCriteria: "Debe filtrar" }).success, true);
});

test("EditTask rechaza vacío y campos inválidos", () => {
  assert.equal(EditTask.safeParse({}).success, false);
  assert.equal(EditTask.safeParse({ title: "ab" }).success, false);
  assert.equal(EditTask.safeParse({ description: "x".repeat(20_001) }).success, false);
});

test("RejectTask válido", () => {
  const r = RejectTask.safeParse({ reason: { category: "scope", text: "Fuera de alcance" } });
  assert.equal(r.success, true);
});

test("RejectTask rechaza categoría desconocida y textos fuera de rango", () => {
  assert.equal(RejectTask.safeParse({ reason: { category: "otra", text: "x" } }).success, false);
  assert.equal(RejectTask.safeParse({ reason: { category: "scope", text: "" } }).success, false);
  assert.equal(
    RejectTask.safeParse({ reason: { category: "scope", text: "x".repeat(5_001) } }).success,
    false,
  );
  assert.equal(RejectTask.safeParse({}).success, false);
});

test("los esquemas aceptan exactamente los valores de las listas del modelo", () => {
  const reason = (category: string) =>
    RejectTask.safeParse({ reason: { category, text: "x" } }).success;
  const create = (risk: string) => CreateTask.safeParse({ ...validCreate, risk }).success;
  for (const c of REASON_CATEGORIES) assert.equal(reason(c), true, c);
  for (const r of RISK_LEVELS) assert.equal(create(r), true, r);
  assert.equal(reason("fuera_de_la_lista"), false);
  assert.equal(create("fuera_de_la_lista"), false);
});
