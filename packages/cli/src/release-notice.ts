import { DEV_RELEASE } from "@togi/daemon/release";
import { clean } from "./format.ts";
import { MESSAGES } from "./messages.ts";

/**
 * La versión que enseña `togi daemon status`: la etiqueta instalada con su commit corto
 * (`v0.2.0 (0123456)`), o la del package.json si el daemon corre desde el repo o es muy viejo.
 */
export function versionText(health: { daemon: string; release?: string; commit?: string }): string {
  const { release, commit } = health;
  if (release === undefined || release === DEV_RELEASE) return clean(health.daemon);
  return commit === undefined ? clean(release) : `${clean(release)} (${clean(commit).slice(0, 7)})`;
}

/**
 * El aviso de que el daemon y la CLI son versiones distintas, o `undefined` si no procede: un daemon
 * viejo sin campo `release`, o cualquiera de los dos en `dev` (ejecutado desde el repo), donde la
 * diferencia es esperada.
 */
export function releaseNotice(cli: string, daemon: string | undefined): string | undefined {
  if (daemon === undefined || daemon === cli) return undefined;
  if (daemon === DEV_RELEASE || cli === DEV_RELEASE) return undefined;
  const m = MESSAGES.release_mismatch?.({ cliRelease: cli, daemonRelease: daemon });
  return m === undefined ? undefined : `${m.text} ${m.next?.label} \`${m.next?.command}\`.`;
}
