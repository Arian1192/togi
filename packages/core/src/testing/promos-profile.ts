import type { RepoProfile } from "../model/repo-profile.ts";

/** El perfil de `promos` aprobado por Arian el 10 de noviembre (ADR-011 §5), tal cual. */
export const PROMOS_PROFILE: RepoProfile = {
  install: "pnpm install --frozen-lockfile",
  checks: { typecheck: "pnpm typecheck", lint: null, test: "pnpm test" },
  testFiles: ["apps/**/*.test.{ts,tsx}", "apps/web/e2e/**"],
  protectedPaths: [
    "apps/*/src/test/**",
    "apps/api/drizzle/**",
    "**/vitest.config.ts",
    "**/playwright.config.ts",
    "apps/api/drizzle.config.ts",
    "bruno/**/.env*",
    "package-lock.json",
  ],
  docs: ["docs/**", "**/*.md"],
  registry: ["registry.npmjs.org"],
  testExclude: ["apps/api/src/server.test.ts"],
};
