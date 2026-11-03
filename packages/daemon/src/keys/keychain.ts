/** Guarda la clave maestra fuera del workspace del agente (ADR-004). */
export interface Keychain {
  /** `null` solo si la clave no existe; cualquier otro fallo lanza. */
  get(): Promise<Uint8Array | null>;
  /** Crea la clave. Falla si ya existe: nunca la sobrescribe. */
  create(key: Uint8Array): Promise<void>;
}

const HEX_KEY = /^[0-9a-f]{64}$/;

export const toHex = (key: Uint8Array): string => Buffer.from(key).toString("hex");

export function fromHex(text: string): Uint8Array {
  const hex = text.trim();
  if (!HEX_KEY.test(hex)) throw new Error("la clave guardada no es de 32 bytes en hexadecimal");
  return new Uint8Array(Buffer.from(hex, "hex"));
}
