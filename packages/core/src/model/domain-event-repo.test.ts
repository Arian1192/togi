import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoredEvent } from "../ports/event-store.ts";
import { PROMOS_PROFILE } from "../testing/promos-profile.ts";
import { EVENT_TYPES, EventParseError, isTaskEvent, toDomainEvent } from "./domain-event.ts";

// `repo.profile_set` (ADR-011 §5): se lee en el stream de su repo y en ningún otro.

const payload = { repo: "Arian1192/promos", profile: PROMOS_PROFILE };
const stored = (
  stream: string,
  type = "repo.profile_set",
  body: unknown = payload,
): StoredEvent => ({
  seq: 4,
  stream,
  streamVersion: 1,
  type,
  schemaVersion: 1,
  actor: { kind: "human", userId: "usr_1" },
  at: "2026-11-11T10:00:00Z",
  payload: body,
  prevHash: "p",
  hash: "h",
});
const rejects = (event: StoredEvent) =>
  assert.throws(
    () => toDomainEvent(event),
    (e) => e instanceof EventParseError && e.seq === 4,
  );

test("repo.profile_set es un tipo conocido", () => {
  assert.ok(EVENT_TYPES.includes("repo.profile_set"));
});

test("en el stream de su repo se lee tal cual y no es un evento de tarea", () => {
  const event = toDomainEvent(stored("repo:arian1192/promos"));
  assert.deepEqual(event.payload, payload);
  assert.equal(isTaskEvent(event), false);
});

test("en el stream de otro repo, de una tarea o sin minúsculas se rechaza", () => {
  rejects(stored("repo:arian1192/otro"));
  rejects(stored("repo:Arian1192/promos"));
  rejects(stored("task:7"));
  rejects(stored("admin"));
});

test("un evento de tarea en un stream de repo se rechaza", () => {
  rejects(stored("repo:arian1192/promos", "task.submitted", {}));
});

test("un perfil inválido o un repo mal formado se rechazan al leer", () => {
  rejects(stored("repo:arian1192/promos", "repo.profile_set", { ...payload, extra: true }));
  const badProfile = { ...payload, profile: { ...PROMOS_PROFILE, install: "pnpm i; curl x" } };
  rejects(stored("repo:arian1192/promos", "repo.profile_set", badProfile));
  rejects(stored("repo:-x/promos", "repo.profile_set", { ...payload, repo: "-x/promos" }));
});
