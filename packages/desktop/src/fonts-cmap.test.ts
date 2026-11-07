import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { brotliDecompressSync } from "node:zlib";

// Un `unicode-range` que declara un carácter que el fichero no trae manda ese carácter a una fuente
// sin glifo en lugar de a la de reserva. Este test lee el mapa de caracteres (cmap) del propio
// woff2, sin dependencias, y comprueba cada carácter declarado.

const FONTS = join(import.meta.dirname, "fonts");
const css = readFileSync(join(import.meta.dirname, "fonts.css"), "utf8");

/** Los códigos de carácter con glifo en un woff2 (cmap de formato 4 y 12, que no se transforma). */
function cmapOf(file: Buffer): Set<number> {
  assert.equal(file.toString("latin1", 0, 4), "wOF2");
  const numTables = file.readUInt16BE(12);
  const compressedSize = file.readUInt32BE(20);
  let pos = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = file.readUInt8(pos++);
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error("UIntBase128 no válido");
  };
  // El directorio dice cuánto ocupa cada tabla en el flujo comprimido; hace falta para llegar a cmap.
  let offset = 0;
  let cmapAt = 0;
  let cmapLength = 0;
  for (let i = 0; i < numTables; i++) {
    const flags = file.readUInt8(pos++);
    const index = flags & 0x3f;
    if (index === 63) pos += 4; // etiqueta explícita
    const version = flags >> 6;
    const length = base128();
    // glyf (10) y loca (11) vienen transformadas salvo con versión 3; hmtx (3), solo con versión 1.
    const transformed = index === 10 || index === 11 ? version !== 3 : index === 3 && version === 1;
    const stored = transformed ? base128() : length;
    if (index === 0) [cmapAt, cmapLength] = [offset, length];
    offset += stored;
  }
  const data = brotliDecompressSync(file.subarray(pos, pos + compressedSize));
  const cmap = data.subarray(cmapAt, cmapAt + cmapLength);

  const chars = new Set<number>();
  for (let t = 0; t < cmap.readUInt16BE(2); t++) {
    const sub = cmap.readUInt32BE(4 + t * 8 + 4);
    const format = cmap.readUInt16BE(sub);
    if (format === 12) {
      for (let g = 0; g < cmap.readUInt32BE(sub + 12); g++) {
        const at = sub + 16 + g * 12;
        const start = cmap.readUInt32BE(at);
        const end = cmap.readUInt32BE(at + 4);
        const glyph = cmap.readUInt32BE(at + 8);
        for (let c = start; c <= end; c++) if (glyph + (c - start) > 0) chars.add(c);
      }
    } else if (format === 4) {
      const segs = cmap.readUInt16BE(sub + 6) / 2;
      const ends = sub + 14;
      const starts = sub + 16 + segs * 2;
      const deltas = sub + 16 + segs * 4;
      const offsets = sub + 16 + segs * 6;
      for (let s = 0; s < segs; s++) {
        const end = cmap.readUInt16BE(ends + s * 2);
        const start = cmap.readUInt16BE(starts + s * 2);
        const delta = cmap.readUInt16BE(deltas + s * 2);
        const rangeOffset = cmap.readUInt16BE(offsets + s * 2);
        for (let c = start; c <= end && c < 0xffff; c++) {
          const glyph =
            rangeOffset === 0
              ? (c + delta) & 0xffff
              : cmap.readUInt16BE(offsets + s * 2 + rangeOffset + (c - start) * 2);
          if (glyph !== 0) chars.add(c);
        }
      }
    }
  }
  return chars;
}

/** Los códigos de un `unicode-range` (`U+0041`, `U+4E00-4E02`). */
function codePoints(range: string): number[] {
  return range.split(",").flatMap((part) => {
    const [lo = 0, hi = lo] = part
      .trim()
      .replace("U+", "")
      .split("-")
      .map((h) => parseInt(h, 16));
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  });
}

const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
  const body = m[1] ?? "";
  return {
    file: /fonts\/([\w-]+\.woff2)/.exec(body)?.[1] ?? "",
    range: /unicode-range:\s*([^;]+);/.exec(body)?.[1] ?? "",
  };
});

const hex = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

test("el lector de cmap distingue lo que trae el latín de M PLUS 1 Code de lo que no", () => {
  const latin = cmapOf(readFileSync(join(FONTS, "m-plus-1-code-latin-400.woff2")));
  for (const cp of [0x41, 0x7a, 0xf1, 0xbf, 0xd7, 0x20ac]) assert.ok(latin.has(cp), hex(cp));
  // ✕, ◆ y あ no están en ese fichero.
  for (const cp of [0x2715, 0x25c6, 0x3042]) assert.ok(!latin.has(cp), hex(cp));
});

test("cada carácter de cada unicode-range existe en el mapa de caracteres de su woff2", () => {
  assert.ok(faces.length >= 18);
  const missing = faces.flatMap(({ file, range }) => {
    const chars = cmapOf(readFileSync(join(FONTS, file)));
    return codePoints(range)
      .filter((cp) => !chars.has(cp))
      .map((cp) => `${file}: ${hex(cp)}`);
  });
  assert.deepEqual(missing, [], "unicode-range declara caracteres que el fichero no trae");
});
