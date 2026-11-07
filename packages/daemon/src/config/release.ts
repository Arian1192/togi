import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Lo que `togi install` escribe en la raíz de cada instalación. */
export interface Release {
  tag: string;
  commit: string;
}

export const RELEASE_FILE = "RELEASE";
/** Versión de quien se ejecuta desde el repo, sin instalar. */
export const DEV_RELEASE = "dev";

// Misma forma que valida `togi install`: nunca empieza por «-» ni lleva «/» ni «..».
const TAG = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const COMMIT = /^[0-9a-f]{40}$/;

/** ¿Es una etiqueta segura para usarla como ruta y como argumento de git? */
export const isValidTag = (tag: string): boolean => TAG.test(tag) && !tag.includes("..");

/**
 * La raíz de este código: la instalación, o el repo si se ejecuta sin instalar. Con `fileURLToPath`:
 * `URL.pathname` deja la ruta codificada (`Application%20Support`) y RELEASE no se encontraba.
 */
export const CODE_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** El `RELEASE` de una raíz, o `undefined` si no existe o no es válido. */
export function readRelease(root: string = CODE_ROOT): Release | undefined {
  try {
    const data = JSON.parse(readFileSync(join(root, RELEASE_FILE), "utf8")) as Partial<Release>;
    const { tag, commit } = data;
    if (typeof tag !== "string" || !isValidTag(tag)) return undefined;
    if (typeof commit !== "string" || !COMMIT.test(commit)) return undefined;
    return { tag, commit };
  } catch {
    return undefined;
  }
}

/** La etiqueta instalada, o «dev» si no hay instalación. */
export const releaseTag = (root: string = CODE_ROOT): string =>
  readRelease(root)?.tag ?? DEV_RELEASE;

/** Lo que `/v1/health` cuenta de la versión: la etiqueta y, si está instalada, el commit exacto. */
export function releaseInfo(root: string = CODE_ROOT): { release: string; commit?: string } {
  const installed = readRelease(root);
  return installed === undefined
    ? { release: DEV_RELEASE }
    : { release: installed.tag, commit: installed.commit };
}
