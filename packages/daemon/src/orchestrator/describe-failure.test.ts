import assert from "node:assert/strict";
import { test } from "node:test";
import { describeFailure, nextStep } from "./describe-failure.ts";

// Por partes: ningún detector de secretos lo ve como una clave en el código fuente.
const KEY = ["sk", "ant", "api03", "A".repeat(40)].join("-");
// biome-ignore lint/suspicious/noControlCharactersInRegex: es justo lo que se comprueba
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

test("un texto sale tal cual, un Error con su nombre y mensaje", () => {
  assert.equal(describeFailure("repo_not_registered"), "repo_not_registered");
  assert.equal(describeFailure(new RangeError("fuera de rango")), "RangeError: fuera de rango");
});

test("un error de regla sale con su código y su mensaje", () => {
  const rule = {
    kind: "domain_error",
    code: "invalid_state",
    message: "solo se planifica en planning",
  };
  assert.equal(describeFailure(rule), "invalid_state: solo se planifica en planning");
});

test("cualquier otra cosa sale como JSON, y lo que no se puede serializar no lanza", () => {
  assert.equal(describeFailure({ a: 1 }), '{"a":1}');
  assert.equal(describeFailure(null), "null");
  assert.equal(describeFailure(undefined), "sin detalle");
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(describeFailure(circular), "[object Object]");
  assert.equal(describeFailure(Symbol.for("x")), "Symbol(x)");
});

test("las claves que reconoce el detector de secretos no salen", () => {
  for (const result of [
    `falló con ${KEY}`,
    new Error(`token ${KEY}`),
    { code: "x", message: KEY },
  ]) {
    const text = describeFailure(result);
    assert.ok(!text.includes("A".repeat(40)), text);
    assert.match(text, /\[REDACTED:anthropic-api-key\]/);
  }
});

test("sin escapes de terminal ni caracteres de control, pero con el salto de línea", () => {
  const text = describeFailure("a\u001b[31mroja\u001b[0m\u009b2J\u007fb\nc\td");
  assert.ok(!CONTROL.test(text), JSON.stringify(text));
  assert.equal(text, "a[31mroja[0m2Jb\nc\td");
});

test("nextStep da un comando concreto con el número de la tarea", () => {
  assert.equal(nextStep("timeout", 7), "reintenta con togi plan retry 7");
  for (const code of ["worker_died", "planner_failed", "planner_error", "max_turns_exceeded"]) {
    assert.match(nextStep(code, 7) ?? "", /togi plan retry 7$/, code);
  }
  assert.match(
    nextStep("credential_missing", 3) ?? "",
    /togi auth set-api-key o togi auth use-subscription y reintenta con togi plan retry 3/,
  );
  assert.match(
    nextStep("budget_exceeded", 3) ?? "",
    /TOGI_MAX_SESSION_COST_USD.*togi plan retry 3/,
  );
  assert.match(
    nextStep("sandbox_unavailable", 3) ?? "",
    /solo funciona en macOS.*togi daemon status/,
  );
  assert.match(nextStep("agent_failed", 3) ?? "", /«agente:».*togi plan retry 3/);
  assert.match(nextStep("invalid_plan", 3) ?? "", /plan válido.*togi plan retry 3/);
});

test("el repo registrado se nombra en el siguiente paso; sin él, un marcador", () => {
  assert.equal(
    nextStep("repo_not_registered", 5, "acme/app"),
    "registra el repo con togi repo add acme/app --path <ruta> y reintenta con togi plan retry 5",
  );
  assert.match(nextStep("repo_not_registered", 5) ?? "", /togi repo add <owner\/repo> --path/);
});

test("un motivo sin siguiente paso conocido da undefined", () => {
  assert.equal(nextStep("daemon_restarted", 1), undefined);
  assert.equal(nextStep("algo_raro", 1), undefined);
});
