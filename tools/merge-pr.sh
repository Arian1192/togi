#!/usr/bin/env bash
# Mergea un PR solo si sus tres jobs de CI están en verde y su rama está al día con main.
# Uso: tools/merge-pr.sh <número del PR>
set -euo pipefail

REQUIRED=("check (22.18.0)" "check (24.22.1)" "sandbox-macos")
pr="${1:?Uso: tools/merge-pr.sh <número del PR>}"

git fetch --quiet origin main
head=$(gh pr view "$pr" --json headRefOid --jq '.headRefOid')
git fetch --quiet origin "$head" 2>/dev/null || git fetch --quiet origin "pull/$pr/head"

if ! git merge-base --is-ancestor origin/main "$head"; then
  echo "✗ El PR #$pr no está al día con main. Actualízalo con: gh pr update-branch $pr --rebase"
  exit 1
fi

checks=$(gh pr checks "$pr" --json name,state)
for name in "${REQUIRED[@]}"; do
  state=$(jq -r --arg n "$name" '.[] | select(.name == $n) | .state' <<<"$checks")
  if [[ "$state" != "SUCCESS" ]]; then
    echo "✗ El job «${name}» del PR #$pr no está en verde (${state:-no existe}). No se mergea."
    exit 1
  fi
done

echo "✓ Los tres jobs están en verde y el PR está al día con main."
gh pr merge "$pr" --rebase --delete-branch
