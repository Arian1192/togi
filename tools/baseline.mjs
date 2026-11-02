#!/usr/bin/env node
// Línea base de métricas a partir de PRs mergeados hacia una rama base.
// Requisitos: Node >= 22 y GitHub CLI (`gh`) autenticado. Sin dependencias.
//
// Uso:
//   node baseline.mjs --repo Arian1192/promos --base dev --since 2026-10-01 [--json out.json]
//
// Métricas por PR:
//   leadTimeH   horas desde que se abre el PR hasta el merge
//   size        líneas añadidas + borradas
//   iterations  commits en el PR (aproximación al número de vueltas hasta pasar CI)
//   assisted    algún commit lleva el trailer "Assisted-by:"
//   rework      PR fix(...) que toca ficheros cambiados por un feat(...) mergeado en los 7 días previos
//   revert      el título empieza por "Revert"

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, [])
);
const repo = args.repo ?? "Arian1192/promos";
const base = args.base ?? "dev";
const since = args.since ?? new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10);
const REWORK_WINDOW_DAYS = 7;

// Consulta GraphQL propia: `gh pr list --json commits` pide también los autores de cada
// commit y supera el límite de 500.000 nodos de GitHub. Aquí pedimos solo lo necesario.
const QUERY = `
query($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title url createdAt mergedAt additions deletions
        files(first: 100) { nodes { path } }
        commits(first: 100) { nodes { commit { messageBody } } }
      }
    }
  }
}`;

function fetchMergedPRs() {
  const q = `repo:${repo} is:pr is:merged base:${base} merged:>=${since}`;
  const all = [];
  let cursor = null;
  do {
    const ghArgs = ["api", "graphql", "-f", `query=${QUERY}`, "-f", `q=${q}`];
    if (cursor) ghArgs.push("-f", `cursor=${cursor}`);
    const page = JSON.parse(
      execFileSync("gh", ghArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    ).data.search;
    for (const n of page.nodes) {
      all.push({
        ...n,
        files: n.files.nodes,
        commits: n.commits.nodes.map((c) => c.commit),
      });
    }
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return all;
}

const CC = /^(\w+)(?:\(([^)]+)\))?!?:/; // conventional commit: tipo(ámbito):
const prs = fetchMergedPRs()
  .map((p) => {
    const m = p.title.match(CC);
    return {
      number: p.number,
      title: p.title,
      url: p.url,
      type: m?.[1] ?? "other",
      scope: m?.[2] ?? "-",
      createdAt: new Date(p.createdAt),
      mergedAt: new Date(p.mergedAt),
      leadTimeH: (new Date(p.mergedAt) - new Date(p.createdAt)) / 36e5,
      size: p.additions + p.deletions,
      iterations: p.commits.length,
      assisted: p.commits.some((c) => /^Assisted-by:/im.test(c.messageBody ?? "")),
      files: new Set(p.files.map((f) => f.path)),
      revert: /^revert/i.test(p.title),
    };
  })
  .sort((a, b) => a.mergedAt - b.mergedAt);

for (const pr of prs) {
  pr.rework =
    pr.type === "fix" &&
    prs.some(
      (f) =>
        f.type === "feat" &&
        f.mergedAt < pr.mergedAt &&
        pr.mergedAt - f.mergedAt <= REWORK_WINDOW_DAYS * 864e5 &&
        [...pr.files].some((path) => f.files.has(path))
    );
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "-");
const fmt = (x, d = 1) => (x == null ? "-" : x.toFixed(d));

function summary(group) {
  const fixes = group.filter((p) => p.type === "fix");
  return {
    prs: group.length,
    leadTimeMedianH: median(group.map((p) => p.leadTimeH)),
    sizeMedian: median(group.map((p) => p.size)),
    singleCommit: pct(group.filter((p) => p.iterations === 1).length, group.length),
    fixShare: pct(fixes.length, group.length),
    reworkOfFixes: pct(fixes.filter((p) => p.rework).length, fixes.length),
    reverts: group.filter((p) => p.revert).length,
    assisted: pct(group.filter((p) => p.assisted).length, group.length),
  };
}

const groups = { total: prs };
for (const p of prs) (groups[`scope:${p.scope}`] ??= []).push(p);

console.log(`# Línea base · ${repo} → ${base} · PRs mergeados desde ${since}\n`);
console.log("| Grupo | PRs | Lead time mediano (h) | Tamaño mediano | 1 commit | % fix | Retrabajo (de fix) | Reverts | Asistidos |");
console.log("|---|---|---|---|---|---|---|---|---|");
const out = {};
for (const [name, group] of Object.entries(groups)) {
  const s = (out[name] = summary(group));
  console.log(`| ${name} | ${s.prs} | ${fmt(s.leadTimeMedianH)} | ${fmt(s.sizeMedian, 0)} | ${s.singleCommit} | ${s.fixShare} | ${s.reworkOfFixes} | ${s.reverts} | ${s.assisted} |`);
}

if (args.json) {
  const detail = prs.map(({ files, ...p }) => ({ ...p, files: [...files] }));
  writeFileSync(args.json, JSON.stringify({ repo, base, since, generatedAt: new Date(), summary: out, prs: detail }, null, 2));
  console.log(`\nDetalle por PR en ${args.json}`);
}
