import {
  OWNER_REPO,
  type RepoProfile,
  RepoProfileSchema,
  repoStream,
  setRepoProfile,
  toDomainEvent,
  VersionConflictError,
} from "@togi/core";
import type Database from "better-sqlite3";
import { type Context, Hono } from "hono";
import { applyProjections } from "../projections/index.ts";
import type { SqliteEventStore } from "../store/event-store.ts";
import type { AppEnv } from "./app.ts";
import { domainStatus, problem } from "./problem.ts";

interface ProfileRow {
  repo: string;
  profile: string;
  stream_version: number;
  set_at: string;
}

/**
 * Perfil del repo (ADR-011 §5): lo lee la proyección `repo_profiles` y lo fija un humano con
 * `repo.profile_set` en el stream del repo. El repo tiene que estar registrado. Sin `store`, el PUT
 * responde 503.
 */
export function repoProfileRoutes(db: Database.Database, store: SqliteEventStore | undefined) {
  const registered = db.prepare("SELECT repo FROM repos WHERE repo = ?");
  const select = db.prepare(
    "SELECT repo, profile, stream_version, set_at FROM repo_profiles WHERE repo = ?",
  );

  /** El nombre del repo tal como se registró, o la respuesta 404. */
  const registeredRepo = (c: Context<AppEnv>): string | Response => {
    const { owner, name } = c.req.param() as { owner: string; name: string };
    const row = OWNER_REPO.test(`${owner}/${name}`)
      ? (registered.get(`${owner}/${name}`) as { repo: string } | undefined)
      : undefined;
    return row?.repo ?? problem(404, "repo_not_found", "repo no registrado");
  };

  const profileResponse = (repo: string): Response => {
    const row = select.get(repo) as ProfileRow | undefined;
    if (row === undefined) return problem(404, "repo_profile_not_found", `${repo} no tiene perfil`);
    return Response.json({
      repo: row.repo,
      profile: JSON.parse(row.profile) as RepoProfile,
      version: row.stream_version,
      setAt: row.set_at,
    });
  };

  /** El perfil vigente y la versión del stream, leídos del log y no de la proyección. */
  const current = async (log: SqliteEventStore, stream: string) => {
    let profile: RepoProfile | null = null;
    let version = 0;
    for await (const stored of log.readStream(stream)) {
      const event = toDomainEvent(stored);
      if (event.type === "repo.profile_set") profile = event.payload.profile;
      version = stored.streamVersion;
    }
    return { profile, version };
  };

  return new Hono<AppEnv>()
    .get("/v1/repos/:owner/:name/profile", (c) => {
      const repo = registeredRepo(c);
      return repo instanceof Response ? repo : profileResponse(repo);
    })
    .put("/v1/repos/:owner/:name/profile", async (c) => {
      if (store === undefined) return problem(503, "not_configured", "comandos no disponibles");
      const repo = registeredRepo(c);
      if (repo instanceof Response) return repo;
      const json: unknown = await c.req.json().catch(() => undefined);
      if (json === undefined) return problem(400, "invalid_json", "el cuerpo no es JSON");
      const parsed = RepoProfileSchema.safeParse(json);
      if (!parsed.success) return problem(400, "validation_error", parsed.error.message);
      const stream = repoStream(repo);
      const { profile, version } = await current(store, stream);
      const at = new Date().toISOString();
      const decided = setRepoProfile(profile, repo, parsed.data, c.get("actor"), at);
      if (!Array.isArray(decided)) {
        return problem(domainStatus(decided.code), decided.code, decided.message);
      }
      // Sin eventos, el perfil ya era ese: se responde el vigente.
      if (decided.length === 0) return profileResponse(repo);
      try {
        store.appendWithin(stream, version, decided, (stored, tx) => {
          for (const event of stored) applyProjections(tx, toDomainEvent(event));
        });
      } catch (error) {
        if (error instanceof VersionConflictError) {
          return problem(409, "version_conflict", "otra escritura se adelantó; vuelve a leer");
        }
        throw error;
      }
      return profileResponse(repo);
    });
}
