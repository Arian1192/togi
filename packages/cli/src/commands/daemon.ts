import { createClient } from "../client.ts";
import type { Command } from "./index.ts";

const status: Command = {
  summary: "Muestra si el daemon está en marcha.",
  example: "togi daemon status",
  async run({ home, json, out }) {
    const client = createClient(home);
    const health = await client.checked<{ daemon: string; schema: number }>(
      await client.api.v1.health.$get(),
    );
    if (json) return `${JSON.stringify(health)}\n`;
    return `${out.mark("ok", `Daemon en marcha · versión ${health.daemon} · ${client.socket}`)}\n`;
  },
};

export const daemon = { status };
