import { createClient } from "../client.ts";
import { CliError, usageError } from "../errors.ts";
import { say } from "../format.ts";
import type { Command } from "./index.ts";

type Mode = "api-key" | "subscription";

const noArgs = (args: string[], command: string): void => {
  // Un argumento podría ser el secreto: el error no lo repite.
  if (args.length > 0) {
    throw usageError("invalid_option", {
      field: "un argumento",
      detail: "el secreto se lee por la entrada estándar, nunca como argumento",
      command,
    });
  }
};

function setter(mode: Mode, verb: string, what: string, prompt: string, done: string): Command {
  const command = `togi auth ${verb} --help`;
  return {
    summary: `Guarda ${what} en el Llavero.`,
    example: `pbpaste | togi auth ${verb}`,
    usage: `Uso: togi auth ${verb} [--json]

Lee ${what} por la entrada estándar y la guarda en el Llavero, sustituyendo la del otro modo.
Por tubería, o en una terminal sin eco. Nunca como argumento ni variable de entorno, y el daemon
no la devuelve nunca.

Ejemplo:
  pbpaste | togi auth ${verb}
`,
    async run({ home, json, out, args, readSecret }) {
      noArgs(args, command);
      const client = createClient(home); // si no hay daemon, falla antes de pedir nada
      const secret = await readSecret(prompt, command);
      const res = await client.api.v1["agent-credential"].$put(
        {},
        {
          headers: { "content-type": "application/json" },
          init: { body: JSON.stringify({ mode, secret }) },
        },
      );
      // Sin contexto con el cuerpo: el secreto no puede acabar en un mensaje.
      const saved = await client.checked<{ mode: Mode }>(res, { field: "la credencial" });
      return json ? `${JSON.stringify(saved)}\n` : `${out.mark("ok", say(done))}\n`;
    },
  };
}

const status: Command = {
  summary: "Muestra el modo de credencial activo, sin valores.",
  example: "togi auth status",
  usage: `Uso: togi auth status [--json]

Dice qué modo está activo (clave de API o suscripción) o si no hay credencial. Nunca muestra
valores. Si quedan las dos entradas, sale con 4: repite el cambio de modo.

Ejemplo:
  togi auth status
`,
  async run({ home, json, out, args }) {
    noArgs(args, "togi auth status --help");
    const client = createClient(home);
    const res = await client.checked<{ mode: Mode | "inconsistent" | null }>(
      await client.api.v1["agent-credential"].$get(),
    );
    const body = `${JSON.stringify(res)}\n`;
    if (res.mode === "inconsistent") {
      throw new CliError(
        "credentials_inconsistent",
        4,
        { requestId: client.requestId },
        undefined,
        json ? body : undefined,
      );
    }
    if (json) return body;
    const key = res.mode === null ? "none" : res.mode === "api-key" ? "api_key" : "subscription";
    return `${out.mark(res.mode === null ? "muted" : "ok", say(`auth_status_${key}`))}\n`;
  },
};

export const auth = {
  "set-api-key": setter(
    "api-key",
    "set-api-key",
    "la clave de API",
    "Clave de API (no se muestra): ",
    "auth_api_key_saved",
  ),
  "use-subscription": setter(
    "subscription",
    "use-subscription",
    "el token de suscripción",
    "Token de suscripción (no se muestra): ",
    "auth_subscription_saved",
  ),
  status,
};
