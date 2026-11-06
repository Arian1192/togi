import { DEV_RELEASE } from "@togi/daemon/release";
import { MESSAGES } from "./messages.ts";

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
