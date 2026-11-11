import assert from "node:assert/strict";
import { test } from "node:test";
import type { Actor } from "../model/ids.ts";
import { PROMOS_PROFILE } from "../testing/promos-profile.ts";
import { isDomainError } from "./errors.ts";
import { setRepoProfile } from "./set-repo-profile.ts";

const at = "2026-11-11T10:00:00.000Z";
const human: Actor = { kind: "human", userId: "usr_1" };
const repo = "Arian1192/promos";

test("el primer perfil emite repo.profile_set con el repo y el perfil completo", () => {
  const result = setRepoProfile(null, repo, PROMOS_PROFILE, human, at);
  assert.ok(!isDomainError(result));
  assert.deepEqual(result, [
    {
      schemaVersion: 1,
      actor: human,
      at,
      type: "repo.profile_set",
      payload: { repo, profile: PROMOS_PROFILE },
    },
  ]);
});

test("fijar el mismo perfil otra vez no emite nada, aunque cambie el orden de las claves", () => {
  const reordered = {
    ...PROMOS_PROFILE,
    checks: { test: "pnpm test", lint: null, typecheck: "pnpm typecheck" },
  };
  assert.deepEqual(setRepoProfile(PROMOS_PROFILE, repo, reordered, human, at), []);
});

test("un perfil distinto del vigente emite otra versión completa", () => {
  const next = { ...PROMOS_PROFILE, checks: { ...PROMOS_PROFILE.checks, lint: "pnpm lint" } };
  const result = setRepoProfile(PROMOS_PROFILE, repo, next, human, at);
  assert.ok(!isDomainError(result));
  assert.deepEqual(result[0]?.payload, { repo, profile: next });
});

test("ni un agente ni el sistema fijan el perfil", () => {
  const actors: Actor[] = [
    { kind: "agent", sessionId: "ses_1", role: "builder" },
    { kind: "system", component: "gates" },
  ];
  for (const actor of actors) {
    const result = setRepoProfile(null, repo, PROMOS_PROFILE, actor, at);
    assert.ok(isDomainError(result));
    assert.equal(result.code, "actor_not_allowed");
  }
});

test("un perfil o un repo inválidos no llegan a emitirse", () => {
  const bad = setRepoProfile(null, repo, { ...PROMOS_PROFILE, testFiles: [] }, human, at);
  assert.ok(isDomainError(bad));
  assert.equal(bad.code, "invalid_payload");
  const badRepo = setRepoProfile(null, "promos", PROMOS_PROFILE, human, at);
  assert.ok(isDomainError(badRepo));
  assert.equal(badRepo.code, "invalid_payload");
});
