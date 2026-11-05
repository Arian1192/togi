import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoredEvent } from "../ports/event-store.ts";
import { EventParseError, toDomainEvent } from "./domain-event.ts";
import { SpecialistSchema, specialistHash } from "./specialist.ts";

const valid = {
  id: "marketing-consultant",
  version: 1,
  role: "planner",
  runtime: "claude-agent-sdk",
  model: "claude-sonnet-5-5",
  tools: ["Read", "Grep"],
  instructions: "Revisa los textos.",
};

test("un especialista válido pasa, y las herramientas pueden ser un subconjunto", () => {
  assert.ok(SpecialistSchema.safeParse(valid).success);
  assert.ok(SpecialistSchema.safeParse({ ...valid, tools: [] }).success);
});

test("un campo de más, uno de menos o un rol fuera de la lista se rechazan", () => {
  assert.equal(SpecialistSchema.safeParse({ ...valid, extra: 1 }).success, false);
  const { model: _model, ...sinModelo } = valid;
  assert.equal(SpecialistSchema.safeParse(sinModelo).success, false);
  assert.equal(SpecialistSchema.safeParse({ ...valid, role: "consultant" }).success, false);
  assert.equal(SpecialistSchema.safeParse({ ...valid, version: 0 }).success, false);
  assert.equal(SpecialistSchema.safeParse({ ...valid, id: "Con Espacios" }).success, false);
});

test("pedir una herramienta que el rol no admite se rechaza", () => {
  for (const tools of [["Write"], ["Read", "Bash"], ["WebFetch"]]) {
    assert.equal(SpecialistSchema.safeParse({ ...valid, tools }).success, false, tools.join());
  }
  // Los roles sin herramientas definidas no admiten ninguna.
  assert.equal(
    SpecialistSchema.safeParse({ ...valid, role: "reviewer", tools: ["Read"] }).success,
    false,
  );
});

test("el hash no depende del orden de las claves y cambia con el contenido", () => {
  const reordered = Object.fromEntries(Object.entries(valid).reverse());
  const a = SpecialistSchema.parse(valid);
  assert.equal(specialistHash(a), specialistHash(SpecialistSchema.parse(reordered)));
  assert.match(specialistHash(a), /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(specialistHash(a), specialistHash({ ...a, instructions: "Otra." }));
});

const spec = SpecialistSchema.parse(valid);
const stored = (payload: unknown, stream = `specialist:${spec.id}`): StoredEvent => ({
  seq: 7,
  stream,
  streamVersion: 1,
  type: "specialist.version_published",
  schemaVersion: 1,
  actor: { kind: "system", component: "catalog" },
  at: "2026-11-05T10:00:00.000Z",
  payload,
  prevHash: "p",
  hash: "h",
});
const good = { specialist: spec, hash: specialistHash(spec) };

test("toDomainEvent lee un evento publicado y devuelve el contenido completo", () => {
  const event = toDomainEvent(stored(good));
  assert.equal(event.type, "specialist.version_published");
  assert.deepEqual((event.payload as typeof good).specialist, spec);
});

test("toDomainEvent rechaza campo de más, de menos, herramientas fuera del rol, hash falso y stream ajeno", () => {
  const bad: [string, StoredEvent][] = [
    ["campo de más", stored({ ...good, extra: 1 })],
    ["sin hash", stored({ specialist: spec })],
    ["herramientas de más", stored({ ...good, specialist: { ...spec, tools: ["Write"] } })],
    ["hash que no casa", stored({ ...good, hash: "sha256:00" })],
    ["stream de otro especialista", stored(good, "specialist:otro")],
    ["stream de tarea", stored(good, "task:1")],
    ["stream admin", stored(good, "admin")],
  ];
  for (const [name, event] of bad) {
    assert.throws(() => toDomainEvent(event), EventParseError, name);
  }
});

test("un evento de tarea no puede vivir en un stream de especialista", () => {
  const submitted = { ...stored({}, "specialist:x"), type: "task.submitted" };
  assert.throws(() => toDomainEvent(submitted), EventParseError);
});
