import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const LABEL = "com.togi.daemon";

/** Ejecuta un programa sin shell y devuelve su salida; lo cambian los tests. */
export type Runner = (cmd: string, args: string[]) => Promise<string>;

export const realRun: Runner = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, (error, stdout, stderr) => {
      if (error === null) resolve(stdout);
      else reject(new Error((stderr || error.message).trim().slice(-500)));
    });
  });

export const defaultAgentsDir = (): string => join(homedir(), "Library", "LaunchAgents");
export const plistPath = (agentsDir: string): string => join(agentsDir, `${LABEL}.plist`);

const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface PlistSpec {
  node: string;
  /** Instalación: de ahí salen el código del daemon y el directorio de trabajo. */
  release: string;
  home: string;
  log: string;
}

/**
 * El plist del daemon. Nunca copia `process.env`: solo un `PATH` constante (launchd arranca con uno
 * mínimo) y `TOGI_HOME`, que es una ruta y no un secreto.
 */
export function renderPlist({ node, release, home, log }: PlistSpec): string {
  const s = (v: string) => `<string>${escapeXml(v)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${s(LABEL)}
  <key>ProgramArguments</key>
  <array>${s(node)}${s(join(release, "packages", "daemon", "src", "main.ts"))}</array>
  <key>WorkingDirectory</key>${s(release)}
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key>${s(log)}
  <key>StandardErrorPath</key>${s(log)}
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key>${s("/usr/bin:/bin:/usr/sbin:/sbin")}<key>TOGI_HOME</key>${s(home)}</dict>
</dict>
</plist>
`;
}

/** ¿Hay un LaunchAgent instalado que gestiona el daemon de esta carpeta TOGI_HOME? */
export function managesHome(home: string, agentsDir: string = defaultAgentsDir()): boolean {
  const file = plistPath(agentsDir);
  if (!existsSync(file)) return false;
  try {
    return readFileSync(file, "utf8").includes(
      `<key>TOGI_HOME</key>${`<string>${escapeXml(home)}</string>`}`,
    );
  } catch {
    return false;
  }
}
