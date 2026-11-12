import type { RepoProfile } from "./repo-profile.ts";

/**
 * Un matcher de globs con la misma gramática que el del worker (`glob-parity.test.ts` lo comprueba):
 * `**` como segmento entero, `*`, `?` y `{a,b}`; todo lo demás es literal. Casa con nombres que
 * empiezan por punto y sin distinguir mayúsculas (APFS las ignora).
 *
 * A diferencia del worker, si algún glob no lo reconoce devuelve `null`: fallar en cerrado depende
 * del uso (para proteger es casar todo, para excluir sería no casar nada), así que decide quien llama.
 */
export function compileGlobs(globs: readonly string[]): ((path: string) => boolean) | null {
  const regexes: RegExp[] = [];
  for (const glob of globs) {
    const regex = toRegex(glob);
    if (regex === null) return null;
    regexes.push(regex);
  }
  return (path) => regexes.some((regex) => regex.test(path));
}

function toRegex(glob: string): RegExp | null {
  let out = "";
  let inBraces = false;
  for (let i = 0; i < glob.length; i++) {
    const ch = glob.charAt(i);
    if (ch === "*" && glob.charAt(i + 1) === "*") {
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

/**
 * Los tests existentes que el builder no puede tocar (ADR-001): las rutas que casan con `testFiles`.
 * No resta `testExclude`: esos tests solo salen del gate `test` (ADR-011 §2), siguen siendo tests.
 * Si `testFiles` tiene un glob que no reconoce, son todas las rutas: falla en cerrado.
 */
export function existingTestsOf(paths: readonly string[], profile: RepoProfile): string[] {
  const isTest = compileGlobs(profile.testFiles);
  return isTest === null ? [...paths] : paths.filter(isTest);
}
