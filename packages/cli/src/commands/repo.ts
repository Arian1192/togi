import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RegisterRepo, type RepoProfile, RepoProfileSchema } from "@togi/core";
import { createClient } from "../client.ts";
import { CliError, usageError } from "../errors.ts";
import { oneLine, relativeTime, say } from "../format.ts";
import { MESSAGES } from "../messages.ts";
import { profileChanges, profileRows } from "../repo-profile-view.ts";
import type { Command } from "./index.ts";

interface Repo {
  repo: string;
  path: string;
  addedAt: string;
}

const REPO = /^\w[\w.-]*\/\w[\w.-]*$/;

/** El único argumento posicional: un owner/repo bien formado. */
function repoArg(args: string[], command: string): string {
  const repo = args[0];
  if (repo === undefined) throw usageError("missing_option", { field: "owner/repo", command });
  if (args.length > 1 || !REPO.test(repo)) {
    throw usageError("invalid_option", { field: "owner/repo", command });
  }
  return repo;
}

const add: Command = {
  summary: "Registra el clon local de un repo.",
  example: "togi repo add Arian1192/promos --path ~/Dev/promos",
  options: { path: { type: "string" } },
  usage: `Uso: togi repo add <owner/repo> --path <ruta> [--json]

Dice a togi dónde está tu clon local de un repo. La ruta puede ser relativa; se guarda resuelta.
Debe ser la raíz de un repo git cuyo remote apunte a ese owner/repo y quedar fuera de ~/.togi.

Ejemplo:
  togi repo add Arian1192/promos --path ~/Dev/promos
`,
  async run({ home, json, out, values, args }) {
    const command = "togi repo add --help";
    const repo = repoArg(args, command);
    if (typeof values.path !== "string") {
      throw usageError("missing_option", { field: "--path", command });
    }
    const body = RegisterRepo.safeParse({ repo, path: resolve(process.cwd(), values.path) });
    if (!body.success) throw usageError("invalid_option", { field: "--path", command });
    const client = createClient(home);
    const added = await client.checked<Repo>(
      await client.api.v1.repos.$post(
        {},
        {
          headers: { "content-type": "application/json" },
          init: { body: JSON.stringify(body.data) },
        },
      ),
      body.data,
    );
    if (json) return `${JSON.stringify(added)}\n`;
    return `${out.mark("ok", say("repo_added", added))}\n`;
  },
};

const list: Command = {
  summary: "Lista los repos registrados.",
  example: "togi repo list",
  usage: `Uso: togi repo list [--json]

Muestra cada repo registrado, la ruta de su clon y cuándo se registró.

Ejemplo:
  togi repo list
`,
  async run({ home, json, out, args }) {
    if (args.length > 0) {
      throw usageError("invalid_option", {
        field: "los argumentos",
        command: "togi repo list --help",
      });
    }
    const client = createClient(home);
    const res = await client.checked<{ repos: Repo[] }>(await client.api.v1.repos.$get());
    if (json) return `${JSON.stringify(res)}\n`;
    if (res.repos.length === 0) {
      const { text, next } = MESSAGES.repos_empty?.({}) ?? { text: "", next: undefined };
      return `${text}\n  ${next?.label}: ${out.paint("accent", next?.command ?? "")}\n`;
    }
    const width = Math.max(...res.repos.map((r) => oneLine(r.repo).length));
    const now = new Date();
    return `${res.repos
      .map(
        (r) =>
          `${out.paint("accent", oneLine(r.repo).padEnd(width))}  ${oneLine(r.path)}  ${out.paint("muted", relativeTime(r.addedAt, now))}`,
      )
      .join("\n")}\n`;
  },
};

const remove: Command = {
  summary: "Da de baja un repo registrado.",
  example: "togi repo remove Arian1192/promos",
  usage: `Uso: togi repo remove <owner/repo> [--json]

Quita el repo del registro. No borra el clon. Una tarea de ese repo que esté planificándose
fallará en su próxima sesión.

Ejemplo:
  togi repo remove Arian1192/promos
`,
  async run({ home, json, out, args }) {
    const repo = repoArg(args, "togi repo remove --help");
    const [owner = "", name = ""] = repo.split("/");
    const client = createClient(home);
    const removed = await client.checked<{ repo: string }>(
      await client.api.v1.repos[":owner"][":name"].$delete({ param: { owner, name } }),
      { repo },
    );
    if (json) return `${JSON.stringify(removed)}\n`;
    return `${out.mark("ok", say("repo_removed", removed))}\n`;
  },
};

/** La respuesta de `GET`/`PUT /v1/repos/:owner/:name/profile`. */
interface ProfileView {
  repo: string;
  profile: RepoProfile;
  version: number;
  setAt: string;
}

type Client = ReturnType<typeof createClient>;

const profileRoute = (client: Client, repo: string) => {
  const [owner = "", name = ""] = repo.split("/");
  return { route: client.api.v1.repos[":owner"][":name"].profile, param: { owner, name } };
};

/** El perfil vigente, o `null` si el repo aún no tiene. */
async function currentProfile(client: Client, repo: string): Promise<ProfileView | null> {
  const { route, param } = profileRoute(client, repo);
  try {
    return await client.checked<ProfileView>(await route.$get({ param }), { repo });
  } catch (error) {
    if (error instanceof CliError && error.code === "repo_profile_not_found") return null;
    throw error;
  }
}

export interface SetProfileInput {
  /** `undefined` con `--yes`; si no, pregunta y devuelve si la persona confirma. */
  confirm?: (question: string) => Promise<boolean>;
  /** Enseña lo que se va a fijar antes de preguntar. */
  show: (text: string) => void;
}

/**
 * Fija el perfil del repo tras enseñar qué cambia. Si ya era ese, no escribe nada y devuelve el
 * vigente con `changed: false`. `null` si la persona cancela en la confirmación.
 */
export async function setRepoProfile(
  home: string,
  repo: string,
  profile: RepoProfile,
  input: SetProfileInput,
): Promise<{ view: ProfileView; changed: boolean } | null> {
  const client = createClient(home);
  const current = await currentProfile(client, repo);
  const name = current?.repo ?? repo;
  if (current === null) {
    input.show(`${say("repo_profile_new", { repo: name })}\n${profileRows(profile)}\n`);
  } else {
    const changes = profileChanges(current.profile, profile);
    if (changes === "") return { view: current, changed: false };
    const head = say("repo_profile_changes", { repo: name, version: current.version });
    input.show(`${head}\n${changes}\n`);
  }
  if (input.confirm !== undefined) {
    if (!(await input.confirm(say("repo_profile_confirm", { repo: name })))) return null;
  }
  const { route, param } = profileRoute(client, repo);
  const view = await client.checked<ProfileView>(
    await route.$put(
      { param },
      {
        headers: { "content-type": "application/json" },
        init: { body: JSON.stringify(profile) },
      },
    ),
    { repo },
  );
  return { view, changed: true };
}

/** Lee y valida el perfil del fichero, sin tocar el daemon. */
function readProfile(path: string): RepoProfile {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), path), "utf8");
  } catch {
    throw usageError("profile_file_unreadable", { path });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw usageError("profile_invalid_json", { path });
  }
  const parsed = RepoProfileSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const why =
    issue?.code === "unrecognized_keys"
      ? `campos desconocidos: ${issue.keys.join(", ")}`
      : (issue?.message ?? "");
  const where = issue === undefined || issue.path.length === 0 ? "" : `${issue.path.join(".")}: `;
  throw usageError("profile_invalid", { path, detail: `${where}${why}` });
}

const profile: Command = {
  summary: "Muestra o fija el perfil de un repo.",
  example: "togi repo profile Arian1192/promos",
  options: {
    set: { type: "string" },
    yes: { type: "boolean", short: "y" },
  },
  usage: `Uso: togi repo profile <owner/repo> [--set <fichero.json>] [--yes] [--json]

Sin --set, muestra el perfil vigente del repo: los comandos de los gates y sus rutas.

Con --set, lee el perfil de un fichero JSON, lo valida, enseña qué cambia respecto al vigente y
pide confirmación antes de fijarlo; --yes la omite, y fuera de una terminal hace falta. Si el
perfil ya es ese, no se cambia nada.

Ejemplo:
  togi repo profile Arian1192/promos --set perfil.json
`,
  async run({ home, json, out, values, args, interactive, confirm }) {
    const command = "togi repo profile --help";
    const repo = repoArg(args, command);
    if (typeof values.set === "string") {
      const wanted = readProfile(values.set);
      const yes = values.yes === true;
      if (!yes && !interactive)
        throw usageError("profile_confirmation_required", { repo, command });
      const show = json && yes ? () => {} : (text: string) => void process.stderr.write(text);
      const done = await setRepoProfile(home, repo, wanted, { show, ...(yes ? {} : { confirm }) });
      if (done === null) return `${say("reject_cancelled")}\n`;
      if (json) return `${JSON.stringify(done.view)}\n`;
      if (!done.changed) return `${say("repo_profile_unchanged", done.view)}\n`;
      return `${out.mark("ok", say("repo_profile_set", done.view))}\n`;
    }
    const client = createClient(home);
    const { route, param } = profileRoute(client, repo);
    const view = await client.checked<ProfileView>(await route.$get({ param }), { repo });
    if (json) return `${JSON.stringify(view)}\n`;
    const head = `${say("repo_profile_header", view)} · ${relativeTime(view.setAt, new Date())}`;
    return `${out.paint("accent", oneLine(view.repo))}  ${head}\n\n${profileRows(view.profile)}\n`;
  },
};

export const repo = { add, list, remove, profile };
