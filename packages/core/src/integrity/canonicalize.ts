// JSON canónico según RFC 8785 (JCS), siguiendo el canonicalizador de su Apéndice A.
// JSON.stringify ya serializa números y cadenas como exige el RFC (§3.2.2) y el orden por
// defecto de sort() es por unidades UTF-16 (§3.2.3). Añade los errores que el RFC marca como MUST
// y omite las propiedades undefined, como JSON.stringify.

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function quote(text: string): string {
  if (LONE_SURROGATE.test(text)) throw new TypeError("canonicalize: sustituto UTF-16 suelto");
  return JSON.stringify(text);
}

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return String(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalize: NaN e Infinity no son JSON");
      return JSON.stringify(value);
    case "string":
      return quote(value);
    case "object": {
      if (Array.isArray(value))
        return `[${value.map((item) => canonicalize(item ?? null)).join(",")}]`;
      const entries = Object.entries(value).filter(([, item]) => item !== undefined);
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([key, item]) => `${quote(key)}:${canonicalize(item)}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalize: ${typeof value} no es JSON`);
  }
}
