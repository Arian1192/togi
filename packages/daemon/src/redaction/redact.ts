import { RULES } from "./rules.ts";

/** Por encima de este tamaño no se intenta limpiar: se descarta (nunca se guarda sin limpiar). */
export const MAX_REDACT_CHARS = 1_000_000;

/** Lo que se guarda en lugar de un contenido que no se pudo limpiar. */
export const DISCARDED = "[DISCARDED:redaction-incomplete]";

const mark = (rule: string): string => `[REDACTED:${rule}]`;

// Cuantificadores acotados y sin anidar; cubre RSA, EC, OPENSSH, ENCRYPTED y PKCS#8.
const PEM_BEGIN = /-----BEGIN [A-Z ]{0,24}PRIVATE KEY-----/g;
const PEM_END = /-----END [A-Z ]{0,24}PRIVATE KEY-----/g;

/**
 * Sustituye cada bloque PEM de clave privada (incluida OpenSSH). Cada búsqueda del final empieza
 * donde acabó la anterior, así que el coste es lineal; una clave sin final se oculta hasta el
 * fin del texto.
 */
function redactPrivateKeys(text: string): string {
  const parts: string[] = [];
  let from = 0;
  PEM_BEGIN.lastIndex = 0;
  for (let begin = PEM_BEGIN.exec(text); begin !== null; begin = PEM_BEGIN.exec(text)) {
    PEM_END.lastIndex = begin.index + begin[0].length;
    const end = PEM_END.exec(text);
    parts.push(text.slice(from, begin.index), mark("private-key"));
    if (end === null) return parts.join("");
    from = end.index + end[0].length;
    PEM_BEGIN.lastIndex = from;
  }
  parts.push(text.slice(from));
  return parts.join("");
}

/**
 * Detector de secretos (ADR-004). `literals` son valores exactos que deben desaparecer, como el
 * token de togi. Si no se puede limpiar con garantías devuelve `DISCARDED`, nunca el original.
 */
export function redact(text: string, literals: readonly string[] = []): string {
  if (text.length > MAX_REDACT_CHARS) return DISCARDED;
  try {
    let out = redactPrivateKeys(text);
    for (const rule of RULES)
      out = out.replace(rule.pattern, `${rule.keep ?? ""}${mark(rule.name)}`);
    for (const literal of literals) {
      if (literal !== "") out = out.split(literal).join(mark("togi-token"));
    }
    return out;
  } catch {
    return DISCARDED;
  }
}
