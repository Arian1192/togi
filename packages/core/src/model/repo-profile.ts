import { z } from "zod";
import type { GateId } from "./building.ts";

// El perfil del repo (ADR-011 §5): los comandos y las rutas de cada repo. Vive en togi, en el stream
// `repo:<owner/repo>`, versionado con `repo.profile_set`; el último evento es el perfil vigente.

export const REPO_STREAM_PREFIX = "repo:";
/** `owner/repo` no distingue mayúsculas (como el registro de repos): el stream va en minúsculas. */
export const repoStream = (repo: string) => `${REPO_STREAM_PREFIX}${repo.toLowerCase()}`;

/** `owner/repo`, con la misma forma que el registro de repos. */
export const OWNER_REPO = /^\w[\w.-]*\/\w[\w.-]*$/;

/** Los gates de capa 2 que ejecutan un comando del perfil (ADR-011 §9). */
export const PROFILE_CHECKS = ["typecheck", "lint", "test"] as const satisfies readonly GateId[];
export type ProfileCheck = (typeof PROFILE_CHECKS)[number];

/**
 * Un comando exacto: palabras separadas por un espacio, sin comillas ni metacaracteres de shell, para
 * que el hook del builder lo compare tal cual y togi lo parta en argumentos sin shell (ADR-011 §6).
 */
const command = z
  .string()
  .max(200)
  .regex(/^[\w@%+=:,./-]+( [\w@%+=:,./-]+)*$/, "un comando exacto, sin metacaracteres de shell");

/** Los argumentos de un comando del perfil, partido por cada espacio y sin shell; lo revalida antes. */
export function commandArgv(text: string): string[] {
  const parsed = command.safeParse(text);
  if (!parsed.success) throw new Error("no es un comando exacto del perfil");
  return parsed.data.split(" ");
}

const hasControlChar = (text: string) =>
  [...text].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);

/** Un glob relativo a la raíz del repo, que nunca sale de ella. */
const glob = z
  .string()
  .min(1)
  .max(256)
  .refine((p) => !p.startsWith("/"), "el glob debe ser relativo")
  .refine((p) => !p.includes("\\"), "el glob no admite barra invertida")
  .refine((p) => !hasControlChar(p), "el glob no admite caracteres de control")
  .refine((p) => !p.split("/").includes(".."), 'el glob no admite segmentos ".."');
const globs = z.array(glob).max(100);

/** Un dominio exacto, en minúsculas y sin comodines. */
const domain = z
  .string()
  .max(253)
  .regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "un dominio exacto");

export const RepoProfileSchema = z.strictObject({
  install: command,
  /**
   * `typecheck` y `test` siempre: sin ellos la verificación no comprueba nada. `lint` puede ser
   * `null` si el repo no tiene (como `promos`), y entonces su gate no se exige.
   */
  checks: z.strictObject({
    typecheck: command,
    lint: command.nullable(),
    test: command,
  }),
  /** Para `test_integrity` y para medir el diff: sin ellos ningún test estaría protegido. */
  testFiles: globs.min(1),
  /** Solo lo que añade el repo: los mínimos fijos de togi se suman siempre y no se pueden quitar. */
  protectedPaths: globs,
  docs: globs,
  /** Los dominios a los que puede salir la instalación, y solo ella. */
  registry: z.array(domain).max(20),
  /** Tests que el sandbox no puede ejecutar (abren puertos); los corre la CI del repo. */
  testExclude: globs,
});
export type RepoProfile = z.infer<typeof RepoProfileSchema>;

/**
 * Lo que el builder nunca toca, tenga el perfil lo que tenga (ADR-011 §5): lo que usaría para trucar
 * la verificación. El perfil solo añade rutas a estas.
 */
export const PROTECTED_PATH_MINIMUMS = [
  // Manifiestos y lockfiles.
  "**/package.json",
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  "**/npm-shrinkwrap.json",
  "**/yarn.lock",
  "**/bun.lock",
  "**/bun.lockb",
  // Configuración de los gates.
  "**/tsconfig*.json",
  "**/biome.json",
  "**/biome.jsonc",
  "**/.eslintrc*",
  "**/eslint.config.*",
  "**/vitest.config.*",
  "**/vitest.workspace.*",
  "**/jest.config.*",
  "**/.mocharc*",
  "**/playwright.config.*",
  // CI y credenciales.
  ".github/**",
  "**/.env*",
  "**/*.pem",
  "**/*.key",
] as const;

/** Las rutas protegidas vigentes: los mínimos más las del perfil, sin duplicados. */
export const protectedPathsOf = (profile: RepoProfile): string[] => [
  ...new Set<string>([...PROTECTED_PATH_MINIMUMS, ...profile.protectedPaths]),
];

/** Los gates de comando que exige el perfil: los que tienen comando, en el orden de `PROFILE_CHECKS`. */
export const profileChecks = (profile: RepoProfile): GateId[] =>
  PROFILE_CHECKS.filter((check) => profile.checks[check] !== null);
