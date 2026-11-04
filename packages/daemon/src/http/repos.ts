import { RegisterRepo } from "@togi/core";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import { validateRepo } from "../repos/validate-repo.ts";
import type { AppEnv } from "./app.ts";
import { problem } from "./problem.ts";

const OWNER_REPO = /^\w[\w.-]*$/;

/** Registro de repos: owner/repo → ruta del clon local. Sin `home` no se puede validar: 503. */
export function repoRoutes(db: Database.Database, home: string | undefined) {
  const list = db.prepare("SELECT repo, path, added_at AS addedAt FROM repos ORDER BY repo");
  const insert = db.prepare("INSERT INTO repos (repo, path, added_at) VALUES (?, ?, ?)");
  const remove = db.prepare("DELETE FROM repos WHERE repo = ?");

  return new Hono<AppEnv>()
    .get("/v1/repos", (c) => c.json({ repos: list.all() as { repo: string; path: string }[] }))
    .post("/v1/repos", async (c) => {
      if (home === undefined) return problem(503, "not_configured", "registro no disponible");
      const json: unknown = await c.req.json().catch(() => undefined);
      if (json === undefined) return problem(400, "invalid_json", "el cuerpo no es JSON");
      const parsed = RegisterRepo.safeParse(json);
      if (!parsed.success) return problem(400, "validation_error", parsed.error.message);
      const { repo, path } = parsed.data;
      const checked = await validateRepo(repo, path, home);
      if (!checked.ok) return problem(422, checked.code, `${repo}: ${checked.code}`);
      // Sin esperas entre la comprobación y el insert: dos altas a la vez no pueden duplicar.
      const taken = db.prepare("SELECT 1 FROM repos WHERE repo = ?").get(repo);
      if (taken !== undefined) return problem(409, "repo_already_registered", repo);
      const addedAt = new Date().toISOString();
      insert.run(repo, checked.path, addedAt);
      return c.json({ repo, path: checked.path, addedAt }, 201);
    })
    .delete("/v1/repos/:owner/:name", (c) => {
      const { owner, name } = c.req.param();
      if (!OWNER_REPO.test(owner) || !OWNER_REPO.test(name)) {
        return problem(404, "repo_not_found", "repo no registrado");
      }
      if (remove.run(`${owner}/${name}`).changes === 0) {
        return problem(404, "repo_not_found", "repo no registrado");
      }
      return c.json({ repo: `${owner}/${name}` });
    });
}
