import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CliError,
  daemonUnavailable,
  fromProblem,
  renderError,
  usageError,
} from "./errors.ts";
import { createOutput } from "./output.ts";

const plain = createOutput({ env: { LANG: "es_ES.UTF-8" }, isTTY: false, noColorFlag: false });
const render = (e: CliError) => renderError(e, plain);

test("cada code de la guía da su mensaje, siguiente paso y salida", () => {
  const cases: [number, string, number, string][] = [
    [401, "unauthorized", 5, "El token no es válido."],
    [404, "task_not_found", 7, "La tarea #12 no existe."],
    [422, "missing_acceptance_criteria", 3, "La tarea #12 no tiene criterio de aceptación"],
    [422, "task_final", 3, "La tarea #12 ya está cerrada."],
    [422, "invalid_state", 3, "Esta acción no es posible en el estado actual."],
    [422, "invalid_reason", 3, "El rechazo necesita un motivo con texto."],
    [412, "precondition_failed", 4, "La tarea #12 cambió mientras la editabas."],
    [409, "version_conflict", 4, "Otra escritura llegó a la vez."],
    [400, "validation_error", 2, "Un valor no es válido."],
    [500, "integrity_error", 1, "El log o un blob no supera la verificación."],
  ];
  for (const [status, code, exit, message] of cases) {
    const e = fromProblem(status, { code }, { n: 12, requestId: "7f3a9c" });
    assert.equal(e.exitCode, exit, code);
    assert.equal(e.code, code);
    assert.ok(render(e).startsWith(`✗ ${message}`), code);
    assert.ok(render(e).endsWith(`  ${code} · req 7f3a9c\n`), code);
  }
});

test("formato de la guía: mensaje, siguiente paso y línea gris", () => {
  const e = fromProblem(
    422,
    { code: "missing_acceptance_criteria" },
    { n: 12, requestId: "7f3a9c" },
  );
  assert.equal(
    render(e),
    "✗ La tarea #12 no tiene criterio de aceptación, así que no puede salir de draft.\n" +
      "  Añádelo con: togi task edit 12\n" +
      "  missing_acceptance_criteria · req 7f3a9c\n",
  );
});

test("task_final nombra el estado y no sugiere nada", () => {
  const e = fromProblem(422, { code: "task_final" }, { n: 3, state: "rejected" });
  assert.equal(render(e), "✗ La tarea #3 ya está cerrada (rejected).\n  task_final\n");
});

test("validation_error nombra el campo si la CLI lo conoce", () => {
  const e = fromProblem(400, { code: "validation_error" }, { field: "--risk" });
  assert.match(render(e), /Un valor no es válido \(--risk\)\./);
  assert.match(render(e), /togi <comando> --help/);
});

test("el mensaje sale del code, nunca del detail", () => {
  const e = fromProblem(404, { code: "task_not_found", detail: "SECRETO libre" }, { n: 1 });
  assert.doesNotMatch(render(e), /SECRETO/);
});

test("integrity_error va en rojo y recomienda verify-log", () => {
  const out = createOutput({ env: { LANG: "es_ES.UTF-8" }, isTTY: true, noColorFlag: false });
  const text = renderError(fromProblem(500, { code: "integrity_error" }, {}), out);
  assert.ok(text.startsWith("\x1b[31m✗"));
  assert.match(text, /togi admin verify-log/);
  assert.match(text, /manipulación/);
});

test("code desconocido o ausente: mensaje genérico y salida según el status", () => {
  assert.equal(fromProblem(503, { code: "not_configured" }, {}).exitCode, 1);
  assert.equal(fromProblem(428, { code: "precondition_required" }, {}).exitCode, 1);
  assert.equal(fromProblem(422, { code: "algo_nuevo" }, {}).exitCode, 3);
  assert.equal(fromProblem(502, null, {}).exitCode, 1);
  assert.match(render(fromProblem(502, null, {})), /Error inesperado \(HTTP 502\)\./);
});

test("un code con caracteres de control se trata como desconocido y no se imprime", () => {
  const e = fromProblem(502, { code: "x\x1b[2Jboom" }, { requestId: "r1" });
  const text = render(e);
  assert.equal(e.code, "http_502");
  assert.equal(e.exitCode, 1);
  assert.ok(!text.includes("\x1b"));
  assert.match(text, /Error inesperado \(HTTP 502\)\./);
});

test("un code desconocido pero válido muestra el status real", () => {
  const e = fromProblem(418, { code: "algo_nuevo" }, {});
  assert.equal(e.status, 418);
  assert.match(render(e), /Error inesperado \(HTTP 418\)\./);
  assert.match(render(e), /algo_nuevo/);
});

test("sin requestId, la línea gris lleva solo el code", () => {
  assert.match(render(fromProblem(401, { code: "unauthorized" }, {})), /\n {2}unauthorized\n$/);
});

test("daemon no disponible: salida 6 y siguiente paso", () => {
  const e = daemonUnavailable();
  assert.equal(e.exitCode, 6);
  assert.equal(
    render(e),
    "✗ No hay ningún daemon escuchando en el socket.\n  Arráncalo con: togi daemon start\n  daemon_unavailable\n",
  );
});

test("uso incorrecto: salida 2, con sugerencia opcional", () => {
  const e = usageError("unknown_command", {
    command: "togi task sumbit",
    suggestion: "togi task submit",
  });
  assert.equal(e.exitCode, 2);
  assert.equal(
    render(e),
    "✗ Comando desconocido: togi task sumbit\n  ¿Querías decir togi task submit?\n  unknown_command\n",
  );
  assert.equal(usageError("unknown_command", { command: "togi x" }).exitCode, 2);
  assert.doesNotMatch(render(usageError("unknown_command", { command: "togi x" })), /Querías/);
});

test("la salida es siempre un único Error con exitCode del 0 al 7", () => {
  const e = daemonUnavailable();
  assert.ok(e instanceof Error);
  assert.ok(e.exitCode >= 0 && e.exitCode <= 7);
});
