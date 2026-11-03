import { createClient } from "../client.ts";
import { CliError, usageError } from "../errors.ts";
import { MESSAGES } from "../messages.ts";
import type { Command } from "./index.ts";

type Verdict = { ok: true } | { ok: false; brokenAt: number };

const verifyLog: Command = {
  summary: "Verifica la cadena de hashes del log de eventos.",
  example: "togi admin verify-log",
  usage: `Uso: togi admin verify-log [--json]

Recorre el log de eventos y comprueba la cadena de hashes. Si está rota, sale con 1 y
nombra el primer evento que no la supera.

Ejemplo:
  togi admin verify-log
`,
  async run({ home, json, out, args }) {
    if (args.length > 0)
      throw usageError("invalid_option", {
        field: "un argumento",
        detail: "este comando no admite ninguno",
        command: "togi admin verify-log --help",
      });
    const client = createClient(home);
    const verdict = await client.checked<Verdict>(await client.api.v1.admin["verify-log"].$post());
    const body = `${JSON.stringify(verdict)}\n`;
    if (!verdict.ok) {
      const context = { event: verdict.brokenAt, requestId: client.requestId };
      throw new CliError("integrity_error", 1, context, undefined, json ? body : undefined);
    }
    if (json) return body;
    return `${out.mark("ok", MESSAGES.log_verified?.({}).text ?? "")}\n`;
  },
};

export const admin = { "verify-log": verifyLog };
