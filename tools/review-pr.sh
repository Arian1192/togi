#!/usr/bin/env bash
# Prueba un PR en una carpeta propia, sin tocar las de los agentes.
# Uso: tools/review-pr.sh <número del PR> [app]
set -euo pipefail

pr="${1:?Uso: tools/review-pr.sh <número del PR> [app]}"
dir="$HOME/Documents/Dev/projects/togi-review"
repo="$HOME/Documents/Dev/projects/togi"

if [[ ! -d "$dir" ]]; then
  git -C "$repo" fetch --quiet origin
  git -C "$repo" worktree add --detach "$dir" origin/main
fi

branch=$(gh pr view "$pr" --json headRefName --jq .headRefName)
cd "$dir"
git fetch --quiet origin
git switch --detach "origin/${branch}"
pnpm install --frozen-lockfile

echo "✓ togi-review está en el PR #${pr} (${branch})."
if [[ "${2:-}" == "app" ]]; then
  pnpm --filter @togi/desktop build
  cd packages/desktop/src-tauri && cargo run --locked --features tauri/custom-protocol
fi
