import { resolve } from "node:path";
import { RegisterRepo } from "@togi/core";
import { createClient } from "../client.ts";
import { usageError } from "../errors.ts";
import { oneLine, relativeTime, say } from "../format.ts";
import { MESSAGES } from "../messages.ts";
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

export const repo = { add, list, remove };
