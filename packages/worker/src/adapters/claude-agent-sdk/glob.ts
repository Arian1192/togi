/**
 * Un matcher de globs propio, sin dependencias: se carga dentro del sandbox. Acepta `**`, `*`, `?` y
 * `{a,b}`; todo lo demás es literal. Los comodines casan con nombres que empiezan por punto y no se
 * distinguen mayúsculas (APFS las ignora). Un glob que no reconoce lo casa todo: falla en cerrado
 * (ADR-003 principio 4, ADR-011 §5).
 */
export function globMatcher(globs: readonly string[]): (path: string) => boolean {
  const regexes = globs.map(toRegex);
  if (regexes.some((regex) => regex === null)) return () => true;
  return (path) => regexes.some((regex) => regex?.test(path));
}

function toRegex(glob: string): RegExp | null {
  let out = "";
  let inBraces = false;
  for (let i = 0; i < glob.length; i++) {
    const ch = glob.charAt(i);
    if (ch === "*" && glob.charAt(i + 1) === "*") {
      // `**` solo como segmento entero.
      const after = glob.charAt(i + 2);
      if ((i > 0 && glob.charAt(i - 1) !== "/") || (after !== "" && after !== "/")) return null;
      out += after === "/" ? "(?:[^/]*/)*" : ".*";
      i += after === "/" ? 2 : 1;
    } else if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else if (ch === "{") {
      if (inBraces) return null;
      inBraces = true;
      out += "(?:";
    } else if (ch === "}") {
      if (!inBraces) return null;
      inBraces = false;
      out += ")";
    } else if (ch === "," && inBraces) out += "|";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return inBraces ? null : new RegExp(`^${out}$`, "is");
}
