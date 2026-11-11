import { isDeepStrictEqual } from "node:util";
import type { RepoProfile } from "@togi/core";
import { oneLine } from "./format.ts";

type Value = string | null | string[];

/** Los campos del perfil con el nombre que tienen en el fichero JSON, en su orden. */
const FIELDS: [string, (p: RepoProfile) => Value][] = [
  ["install", (p) => p.install],
  ["checks.typecheck", (p) => p.checks.typecheck],
  ["checks.lint", (p) => p.checks.lint],
  ["checks.test", (p) => p.checks.test],
  ["testFiles", (p) => p.testFiles],
  ["protectedPaths", (p) => p.protectedPaths],
  ["docs", (p) => p.docs],
  ["registry", (p) => p.registry],
  ["testExclude", (p) => p.testExclude],
];
const WIDTH = Math.max(...FIELDS.map(([name]) => name.length));

/** Un valor en una línea: `—` si es `null` o una lista vacía. */
const text = (value: Value): string => {
  if (value === null || (Array.isArray(value) && value.length === 0)) return "—";
  return oneLine(Array.isArray(value) ? value.join(", ") : value);
};

const row = (name: string, value: string) => `  ${name.padEnd(WIDTH)}  ${value}`;

/** Cada campo en una fila, con sangría y alineado. */
export const profileRows = (profile: RepoProfile): string =>
  FIELDS.map(([name, get]) => row(name, text(get(profile)))).join("\n");

/** Solo los campos que cambian, como `antes → después`. Vacío si los perfiles son iguales. */
export const profileChanges = (before: RepoProfile, after: RepoProfile): string =>
  FIELDS.filter(([, get]) => !isDeepStrictEqual(get(before), get(after)))
    .map(([name, get]) => row(name, `${text(get(before))} → ${text(get(after))}`))
    .join("\n");
