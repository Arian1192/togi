#!/usr/bin/env node
// Mide el tamaño de un cambio según el ADR-007.
// Uso: node tools/diff-size.mjs [base]   (por defecto, main)
// Compara base...HEAD más lo que haya en el índice y en el árbol de trabajo, ignorando
// cambios de espacios (-w). Sale con 1 si se pasa de los límites, contando el margen.
import { execFileSync } from "node:child_process";

const PROD_LIMIT = 200;
const TOTAL_LIMIT = 500;
const MARGIN = 0.1;

const base = process.argv[2] ?? "main";
let mergeBase;
try {
  mergeBase = execFileSync("git", ["merge-base", base, "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  console.error(`No encuentro la rama base «${base}». Uso: node tools/diff-size.mjs [base]`);
  process.exit(2);
}
const numstat = execFileSync("git", ["diff", "--numstat", "-w", mergeBase], { encoding: "utf8" });

const isTest = (p) =>
  /\.test\.[cm]?[jt]sx?$/.test(p) || /(^|\/)testing\//.test(p) || p.startsWith("packages/e2e/");
const isDoc = (p) => p.endsWith(".md") || p.startsWith("docs/");
const isIgnored = (p) => p === "pnpm-lock.yaml";

const totals = { prod: 0, tests: 0, docs: 0, ignored: 0 };
for (const line of numstat.split("\n")) {
  if (line.trim() === "") continue;
  const [added, removed, path] = line.split("\t");
  if (added === "-" || path === undefined) continue; // binarios
  const changed = Number(added) + Number(removed);
  if (isIgnored(path)) totals.ignored += changed;
  else if (isTest(path)) totals.tests += changed;
  else if (isDoc(path)) totals.docs += changed;
  else totals.prod += changed;
}

const total = totals.prod + totals.tests + totals.docs;
const withMargin = (limit) => Math.floor(limit * (1 + MARGIN));
const check = (value, limit) =>
  value <= limit ? "ok" : value <= withMargin(limit) ? "margen" : "excede";

const prodState = check(totals.prod, PROD_LIMIT);
const totalState = check(total, TOTAL_LIMIT);

console.log(`Producción  ${String(totals.prod).padStart(5)}  límite ${PROD_LIMIT}  ${prodState}`);
console.log(`Tests       ${String(totals.tests).padStart(5)}`);
console.log(`Docs        ${String(totals.docs).padStart(5)}`);
console.log(`Total       ${String(total).padStart(5)}  límite ${TOTAL_LIMIT}  ${totalState}`);
console.log(`(sin contar ${totals.ignored} líneas del lockfile; espacios ignorados)`);

if (prodState === "margen" || totalState === "margen") {
  console.log("Dentro del margen del 10%: declara en el PR que es una sola unidad coherente.");
}
if (prodState === "excede" || totalState === "excede") {
  console.log("Pasa del límite: parte el cambio, o pide aprobación en el plan si es mecánico.");
  process.exit(1);
}
