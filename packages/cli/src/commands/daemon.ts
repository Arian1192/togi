import { paths } from "@togi/daemon/config";
import { releaseTag } from "@togi/daemon/release";
import { createClient } from "../client.ts";
import { DEFAULT_LINES, followLog, logSize, MAX_LINES, tailLog } from "../daemon-logs.ts";
import { CliError, usageError } from "../errors.ts";
import { clean } from "../format.ts";
import { managesHome } from "../launchd.ts";
import { startDaemon, stopDaemon } from "../lifecycle.ts";
import { MESSAGES } from "../messages.ts";
import { releaseNotice, versionText } from "../release-notice.ts";
import type { Command } from "./index.ts";

const status: Command = {
  summary: "Muestra si el daemon está en marcha.",
  example: "togi daemon status",
  async run({ home, json, out }) {
    const client = createClient(home);
    const health = await client.checked<{
      daemon: string;
      schema: number;
      pid: number;
      release?: string;
      commit?: string;
    }>(await client.api.v1.health.$get());
    if (json) return `${JSON.stringify(health)}\n`;
    const planner = await client.checked<{ state: string; reason: string }>(
      await client.api.v1.planner.$get(),
    );
    const plannerText = MESSAGES[`planner_${planner.state}`]?.({ reason: planner.reason }).text;
    // Un daemon más viejo no tiene la ruta: sin ella, la línea queda como estaba.
    let notify: string | undefined;
    try {
      const s = await client.checked<{ state: string; reason: string }>(
        await client.api.v1.notifications.$get(),
      );
      notify = MESSAGES[`notify_${s.state}`]?.({ reason: s.reason }).text;
    } catch {}
    const parts = [
      "Daemon en marcha",
      `versión ${versionText(health)}`,
      `pid ${health.pid}`,
      plannerText ?? clean(planner.state),
      ...(notify === undefined ? [] : [notify]),
      client.socket,
    ];
    const line = parts.join(" · ");
    const notice = releaseNotice(releaseTag(), health.release);
    return `${out.mark("ok", line)}\n${notice === undefined ? "" : `${out.mark("attention", notice)}\n`}`;
  },
};

const start: Command = {
  summary: "Arranca el daemon en segundo plano.",
  example: "togi daemon start",
  async run({ home, json, out }) {
    if (managesHome(home)) throw new CliError("launchagent_managed", 1);
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
    if (managesHome(home)) throw new CliError("launchagent_managed", 1);
    const pid = await stopDaemon(home);
    if (json) return `${JSON.stringify({ stopped: pid !== undefined, pid })}\n`;
    const msg = pid === undefined ? "daemon_not_running" : "daemon_stopped";
    return `${out.mark("ok", MESSAGES[msg]?.(pid === undefined ? {} : { pid }).text ?? "")}\n`;
  },
};

const logs: Command = {
  summary: "Muestra el final del log del daemon (-f para seguirlo).",
  example: "togi daemon logs -n 100",
  options: {
    lines: { type: "string", short: "n" },
    follow: { type: "boolean", short: "f" },
  },
  usage: `Uso: togi daemon logs [-n <líneas>] [-f] [--json]

Muestra el final de daemon.log: las últimas ${DEFAULT_LINES} líneas, o las que pidas con -n (hasta
${MAX_LINES}). Quita las secuencias de escape y los caracteres de control: lo que escriben los agentes
no puede mover la terminal.

  -n, --lines   Cuántas líneas del final mostrar.
  -f, --follow  Sigue el log y muestra las líneas nuevas hasta Ctrl+C.

Con --json escribe {"lines": [...]}; no se combina con -f.

Ejemplo:
  togi daemon logs -f
`,
  async run({ home, json, values, write, signal }) {
    const command = "togi daemon logs --help";
    const raw = values.lines;
    const count = raw === undefined ? DEFAULT_LINES : Number(raw);
    if (raw !== undefined && !(/^[1-9]\d*$/.test(String(raw)) && count <= MAX_LINES)) {
      throw usageError("invalid_option", {
        field: "-n",
        detail: `un número entre 1 y ${MAX_LINES}`,
        command,
      });
    }
    const follow = values.follow === true;
    if (json && follow) {
      throw usageError("invalid_option", {
        field: "--json",
        detail: "no se combina con -f",
        command,
      });
    }
    const file = paths(home).log;
    if (logSize(file) === undefined) throw new CliError("daemon_log_missing", 7);
    const { lines, size } = tailLog(file, count);
    if (json) return `${JSON.stringify({ lines })}\n`;
    const text = lines.map((line) => `${line}\n`).join("");
    if (!follow) return text;
    write(text);
    await followLog(file, size, (line) => write(`${line}\n`), signal);
    return "";
  },
};

export const daemon = { status, start, stop, logs };
