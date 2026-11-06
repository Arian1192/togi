import assert from "node:assert/strict";
import { test } from "node:test";
import { fromProblem, renderError } from "./errors.ts";
import { createOutput } from "./output.ts";

const out = createOutput({ env: { LANG: "es_ES.UTF-8" }, isTTY: false, noColorFlag: true });
const text = (state: unknown, n = 12) =>
  renderError(fromProblem(422, { code: "invalid_state", state }, { n }), out);

test("el estado del problema llega al contexto si es uno de la lista", () => {
  assert.equal(
    fromProblem(422, { code: "invalid_state", state: "planning" }, {}).context.state,
    "planning",
  );
});

test("un estado que no es de la lista, o que no es texto, se ignora", () => {
  for (const state of ["<script>", "draft\u001b[31m", 7, null, undefined, {}]) {
    const error = fromProblem(422, { code: "invalid_state", state }, { n: 1 });
    assert.equal(error.context.state, undefined, String(state));
    assert.match(renderError(error, out), /^✗ Esta acción no es posible en el estado actual\.\n/);
  }
});

test("sin estado, el mensaje es el de siempre, con su siguiente paso", () => {
  assert.match(
    text(undefined),
    /^✗ Esta acción no es posible en el estado actual\.\n {2}Consulta el estado con: togi task show 12\n/,
  );
});

test("draft: dice que no tiene plan y cómo enviarla o editarla", () => {
  const t = text("draft");
  assert.match(
    t,
    /^✗ Esta acción no es posible en el estado actual: #12 está en draft, aún no tiene plan\./,
  );
  assert.match(t, /togi task submit 12/);
  assert.match(t, /togi task edit 12/);
});

test("planning: la planifica el agente; seguir con watch o plan show, y reintentar si falló", () => {
  const t = text("planning");
  assert.match(t, /#12 está en planning, la planifica el agente/);
  assert.match(t, /togi watch/);
  assert.match(t, /togi plan show 12/);
  assert.match(t, /togi plan retry 12/);
});

test("plan_review: espera la decisión; aprobar, pedir cambios (para cambiarlo) o rechazar", () => {
  const t = text("plan_review");
  assert.match(t, /#12 está en plan_review, espera tu decisión sobre el plan/);
  assert.match(t, /togi plan approve 12/);
  assert.match(t, /togi plan request-changes 12 \(para cambiarlo\)/);
  assert.match(t, /togi plan reject 12/);
});

test("building y el resto de estados: ya no admite esa acción", () => {
  for (const state of ["building", "verifying", "review", "merged", "failed", "rejected"]) {
    assert.match(
      text(state),
      new RegExp(`#12 está en ${state}, y ya no admite esa acción\\.`),
      state,
    );
  }
});

test("el código de salida sigue siendo 3", () => {
  assert.equal(fromProblem(422, { code: "invalid_state", state: "planning" }, {}).exitCode, 3);
});
