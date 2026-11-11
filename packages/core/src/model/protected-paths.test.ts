import assert from "node:assert/strict";
import { test } from "node:test";
import { PROMOS_PROFILE } from "../testing/promos-profile.ts";
import { PROTECTED_PATH_MINIMUMS, protectedPathsOf, RepoProfileSchema } from "./repo-profile.ts";

test("los mínimos están siempre, aunque el perfil no traiga rutas", () => {
  const paths = protectedPathsOf({ ...PROMOS_PROFILE, protectedPaths: [] });
  assert.deepEqual([...paths], [...PROTECTED_PATH_MINIMUMS]);
  for (const glob of ["**/package.json", "**/tsconfig*.json", ".github/**", "**/.env*"]) {
    assert.ok(paths.includes(glob), glob);
  }
});

test("el perfil solo añade rutas, sin duplicados", () => {
  const paths = protectedPathsOf(PROMOS_PROFILE);
  for (const glob of [...PROTECTED_PATH_MINIMUMS, ...PROMOS_PROFILE.protectedPaths]) {
    assert.ok(paths.includes(glob), glob);
  }
  assert.equal(new Set(paths).size, paths.length);
  const repeated = protectedPathsOf({ ...PROMOS_PROFILE, protectedPaths: [".github/**", "x/**"] });
  assert.equal(repeated.filter((glob) => glob === ".github/**").length, 1);
  assert.equal(repeated.at(-1), "x/**");
});

test("cada mínimo pasa el glob de RepoProfileSchema", () => {
  const profile = { ...PROMOS_PROFILE, protectedPaths: [...PROTECTED_PATH_MINIMUMS] };
  assert.equal(RepoProfileSchema.safeParse(profile).success, true);
});
