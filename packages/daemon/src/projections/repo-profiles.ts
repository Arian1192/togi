import type { DomainEvent } from "@togi/core";
import type Database from "better-sqlite3";

/** Proyección `repo_profiles`: el perfil vigente de cada repo, SOLO para consultas. */
export function applyToRepoProfiles(db: Database.Database, event: DomainEvent): void {
  if (event.type !== "repo.profile_set") return;
  db.prepare(
    `INSERT INTO repo_profiles (repo, profile, stream_version, set_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (repo) DO UPDATE SET
       profile = excluded.profile, stream_version = excluded.stream_version, set_at = excluded.set_at`,
  ).run(event.payload.repo, JSON.stringify(event.payload.profile), event.streamVersion, event.at);
}
