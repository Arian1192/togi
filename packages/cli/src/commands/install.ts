import { usageError } from "../errors.ts";
import {
  type InstallDeps,
  install as installRelease,
  supportDirOf,
  uninstall as uninstallAgent,
  update as updateRelease,
} from "../install.ts";
import { defaultAgentsDir, realRun } from "../launchd.ts";
import { MESSAGES } from "../messages.ts";
import type { Command } from "./index.ts";

const realDeps = (): InstallDeps => ({
  run: realRun,
  supportDir: supportDirOf(),
  agentsDir: defaultAgentsDir(),
  uid: process.getuid?.() ?? 0,
  node: process.execPath,
  platform: process.platform,
  // macOS tarda en quitar un servicio tras el bootout: se espera hasta 10 s y se reintenta el error 5.
  settle: { pollMs: 200, limitMs: 10_000 },
});

function oneTag(args: string[], verb: string): string {
  const [tag, ...extra] = args;
  if (tag === undefined || extra.length > 0) {
    throw usageError("invalid_option", {
      field: "<etiqueta>",
      detail: `togi ${verb} admite exactamente una`,
      command: `togi ${verb} --help`,
    });
  }
  return tag;
}

export const install: Command = {
  summary: "Instala una versión etiquetada y deja el daemon bajo launchd.",
  example: "togi install v0.1.0",
  usage: `Uso: togi install <etiqueta> [--json]

Clona la etiqueta en ~/Library/Application Support/togi/releases/<etiqueta>, instala sus dependencias,
registra la etiqueta y el commit en RELEASE y activa el daemon como LaunchAgent (com.togi.daemon). Crea
también un lanzador de la CLI instalada. Solo en macOS.

Ejemplo:
  togi install v0.1.0
`,
  async run({ home, json, out, args }) {
    const done = await installRelease(home, oneTag(args, "install"), realDeps());
    if (json) return `${JSON.stringify(done)}\n`;
    const m = MESSAGES.install_done?.({ cliRelease: done.tag, path: done.launcher });
    return `${out.mark("ok", m?.text ?? "")}\n  ${m?.next?.label} ${out.paint("accent", m?.next?.command ?? "")}\n`;
  },
};

export const update: Command = {
  summary: "Instala otra versión etiquetada y reinicia el daemon con ella.",
  example: "togi update v0.2.0",
  usage: `Uso: togi update <etiqueta> [--json]

Instala la etiqueta como togi install, reescribe el plist del LaunchAgent y reinicia el daemon con ella.
Las versiones anteriores no se tocan. Si la instalación falla, no cambia nada ni se reinicia; si falla al
activarla, se restaura el plist anterior. Hace falta haber instalado antes con togi install.

Ejemplo:
  togi update v0.2.0
`,
  async run({ home, json, out, args }) {
    const done = await updateRelease(home, oneTag(args, "update"), realDeps());
    if (json) return `${JSON.stringify(done)}\n`;
    return `${out.mark("ok", MESSAGES.update_done?.({ cliRelease: done.tag }).text ?? "")}\n`;
  },
};

export const uninstall: Command = {
  summary: "Quita el LaunchAgent del daemon.",
  example: "togi uninstall",
  usage: `Uso: togi uninstall [--json]

Para el daemon y borra el plist del LaunchAgent (com.togi.daemon). No toca TOGI_HOME, las versiones
instaladas ni el lanzador de la CLI. Si no había LaunchAgent, lo dice y termina bien.

Ejemplo:
  togi uninstall
`,
  async run({ json, out, args }) {
    if (args.length > 0) {
      throw usageError("invalid_option", {
        field: "un argumento",
        detail: "togi uninstall no admite ninguno",
        command: "togi uninstall --help",
      });
    }
    const done = await uninstallAgent(realDeps());
    if (json) return `${JSON.stringify(done)}\n`;
    const key = done.removed ? "uninstall_done" : "uninstall_none";
    return `${out.mark("ok", MESSAGES[key]?.({}).text ?? "")}\n`;
  },
};
