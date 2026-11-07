import assert from "node:assert/strict";
import { test } from "node:test";
import { STATE_BRAND } from "./state-brand.ts";
import { TASK_STATES } from "./task.ts";

// Tabla literal de «Estados de una tarea» en docs/marca/manual-de-marca.md.
const MANUAL = {
  draft: ["○", "ink-muted", "Falta el criterio de aceptación"],
  planning: ["◐", "agent", "Preparando el plan"],
  plan_review: ["◆", "human", "Plan v2 · espera tu aprobación"],
  building: ["◐", "agent", "Ciclo 1 de 3"],
  verifying: ["◑", "agent", "3 de 5 gates completados"],
  review: ["◆", "human", "Gates en verde · espera tu revisión"],
  merged: ["●", "done", "Mergeada en dev"],
  failed: ["✕", "human", "3 ciclos sin pasar los gates"],
  rejected: ["—", "ink-muted", "Rechazada: [motivo]"],
} as const;

test("cada estado tiene el glifo, el token y el texto del manual, y no sobra ninguno", () => {
  assert.deepEqual(Object.keys(STATE_BRAND).sort(), [...TASK_STATES].sort());
  for (const state of TASK_STATES) {
    const [glyph, token, text] = MANUAL[state];
    assert.deepEqual(STATE_BRAND[state], { glyph, token, text }, state);
  }
});

test("solo hay los glifos y los tokens del manual", () => {
  const brands = Object.values(STATE_BRAND);
  assert.deepEqual([...new Set(brands.map((b) => b.glyph))].sort(), [..."○◐◆◑●✕—"].sort());
  assert.deepEqual([...new Set(brands.map((b) => b.token))].sort(), [
    "agent",
    "done",
    "human",
    "ink-muted",
  ]);
});
