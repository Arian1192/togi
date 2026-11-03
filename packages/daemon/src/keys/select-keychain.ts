import { KEYCHAIN_ENV } from "../config/app.ts";
import { FileKeychain } from "./file-keychain.ts";
import type { Keychain } from "./keychain.ts";
import { MacosKeychain } from "./macos-keychain.ts";

interface Options {
  home: string;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
}

/**
 * Elige la implementación por plataforma. El keychain en fichero solo se usa con
 * TOGI_KEYCHAIN=file explícito; nunca es el fallback de una plataforma sin soporte.
 */
export function selectKeychain({
  home,
  platform = process.platform,
  env = process.env,
}: Options): Keychain {
  const mode = env[KEYCHAIN_ENV];
  if (mode === "file") return new FileKeychain(home);
  if (mode !== undefined && mode !== "") {
    throw new Error(`${KEYCHAIN_ENV}="${mode}" no es válido: solo se admite "file"`);
  }
  if (platform === "darwin") return new MacosKeychain(home);
  throw new Error(`no hay implementación de Keychain para la plataforma "${platform}"`);
}
