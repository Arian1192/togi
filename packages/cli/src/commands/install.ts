import { usageError } from "../errors.ts";
import { install as installRelease, supportDirOf } from "../install.ts";
import { defaultAgentsDir, realRun } from "../launchd.ts";
import { MESSAGES } from "../messages.ts";
import type { Command } from "./index.ts";

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
    const [tag, ...extra] = args;
    if (tag === undefined || extra.length > 0) {
      throw usageError("invalid_option", {
        field: "<etiqueta>",
        detail: "togi install admite exactamente una",
        command: "togi install --help",
      });
    }
    const done = await installRelease(home, tag, {
      run: realRun,
      supportDir: supportDirOf(),
      agentsDir: defaultAgentsDir(),
      uid: process.getuid?.() ?? 0,
      node: process.execPath,
      platform: process.platform,
    });
    if (json) return `${JSON.stringify(done)}\n`;
    const m = MESSAGES.install_done?.({ cliRelease: done.tag, path: done.launcher });
    return `${out.mark("ok", m?.text ?? "")}\n  ${m?.next?.label} ${out.paint("accent", m?.next?.command ?? "")}\n`;
  },
};
