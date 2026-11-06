import { createClient } from "../client.ts";
import { clean } from "../format.ts";
import { startDaemon, stopDaemon } from "../lifecycle.ts";
import { MESSAGES } from "../messages.ts";
import type { Command } from "./index.ts";

const status: Command = {
  summary: "Muestra si el daemon está en marcha.",
  example: "togi daemon status",
  async run({ home, json, out }) {
    const client = createClient(home);
    const health = await client.checked<{ daemon: string; schema: number; pid: number }>(
      await client.api.v1.health.$get(),
    );
    if (json) return `${JSON.stringify(health)}\n`;
    const planner = await client.checked<{ state: string; reason: string }>(
      await client.api.v1.planner.$get(),
    );
    const plannerText = MESSAGES[`planner_${planner.state}`]?.({ reason: planner.reason }).text;
    const line = `Daemon en marcha · versión ${health.daemon} · pid ${health.pid} · ${plannerText ?? clean(planner.state)} · ${client.socket}`;
    return `${out.mark("ok", line)}\n`;
  },
};

const start: Command = {
  summary: "Arranca el daemon en segundo plano.",
  example: "togi daemon start",
  async run({ home, json, out }) {
    const r = await startDaemon(home);
    if (json) return `${JSON.stringify(r)}\n`;
    const key = r.already ? "daemon_already_running" : "daemon_started";
    return `${out.mark("ok", MESSAGES[key]?.(r).text ?? "")}\n`;
  },
};

const stop: Command = {
  summary: "Para el daemon.",
  example: "togi daemon stop",
  async run({ home, json, out }) {
    const pid = await stopDaemon(home);
    if (json) return `${JSON.stringify({ stopped: pid !== undefined, pid })}\n`;
    const msg = pid === undefined ? "daemon_not_running" : "daemon_stopped";
    return `${out.mark("ok", MESSAGES[msg]?.(pid === undefined ? {} : { pid }).text ?? "")}\n`;
  },
};

export const daemon = { status, start, stop };
