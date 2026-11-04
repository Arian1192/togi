import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { hashToken } from "../auth/tokens.ts";
import { openEventDatabase } from "../store/database.ts";
import { createApp } from "./app.ts";

let root: string;
let home: string;
let app: ReturnType<typeof createApp>;
let db: ReturnType<typeof openEventDatabase>;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "togi-repos-api-")));
  home = join(root, "home");
  mkdirSync(home);
  db = openEventDatabase(join(home, "togi.db"));
  db.prepare("INSERT INTO users VALUES (?, ?, ?)").run("usr_1", "owner", "now");
  db.prepare("INSERT INTO tokens VALUES (?, ?, ?)").run(hashToken("tok"), "usr_1", "now");
  app = createApp(db, undefined, undefined, home);
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const send = (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { authorization: "Bearer tok", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const code = async (res: Response) => ((await res.json()) as { code: string }).code;
const clone = (name: string, remote: string): string => {
  const dir = join(root, name);
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "remote", "add", "origin", remote]);
  return dir;
};

test("alta, listado y baja de un repo", async () => {
  const dir = clone("app", "git@github.com:acme/app.git");
  const added = await send("POST", "/v1/repos", { repo: "acme/app", path: dir });
  assert.equal(added.status, 201);
  const list = (await (await send("GET", "/v1/repos")).json()) as { repos: { path: string }[] };
  assert.deepEqual(
    list.repos.map((r) => r.path),
    [dir],
  );
  assert.equal((await send("DELETE", "/v1/repos/acme/app")).status, 200);
  assert.equal((await send("DELETE", "/v1/repos/acme/app")).status, 404);
});

test("un repo ya registrado responde 409, aunque cambien las mayúsculas", async () => {
  const dir = clone("app", "git@github.com:acme/app.git");
  await send("POST", "/v1/repos", { repo: "acme/app", path: dir });
  const again = await send("POST", "/v1/repos", { repo: "ACME/app", path: dir });
  assert.equal(again.status, 409);
  assert.equal(await code(again), "repo_already_registered");
});

test("cada validación se responde con su código y no registra nada", async () => {
  const other = clone("otro", "git@github.com:acme/otro.git");
  const body = (path: string) => ({ repo: "acme/app", path });
  const cases: [unknown, number, string][] = [
    [body(join(root, "nada")), 422, "path_not_found"],
    [body(root), 422, "not_a_git_repo"],
    [body(other), 422, "remote_mismatch"],
    [body(home), 422, "inside_togi_home"],
    [body("relativa/ruta"), 400, "validation_error"],
    [{ repo: "../x", path: other }, 400, "validation_error"],
  ];
  for (const [payload, status, expected] of cases) {
    const res = await send("POST", "/v1/repos", payload);
    assert.equal(res.status, status, expected);
    assert.equal(await code(res), expected);
  }
  const count = db.prepare("SELECT COUNT(*) AS n FROM repos").get() as { n: number };
  assert.equal(count.n, 0);
});

test("sin token no hay acceso y sin home el alta responde 503", async () => {
  const anonymous = await app.request("/v1/repos");
  assert.equal(anonymous.status, 401);
  app = createApp(db);
  const res = await send("POST", "/v1/repos", { repo: "acme/app", path: root });
  assert.equal(res.status, 503);
});
