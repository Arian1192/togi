#!/usr/bin/env bash
# Mergea un PR solo si está abierto, sus tres jobs de CI están en verde y su rama está al día con main.
# Uso: tools/merge-pr.sh <número del PR>
set -euo pipefail

REQUIRED=("check (22.18.0)" "check (24.22.1)" "sandbox-macos" "rust")
pr="${1:?Uso: tools/merge-pr.sh <número del PR>}"

state=$(gh pr view "$pr" --json state --jq '.state')
if [[ "$state" != "OPEN" ]]; then
  echo "✗ El PR #${pr} no está abierto (${state}). No hay nada que mergear."
  exit 1
fi

git fetch --quiet origin main
head=$(gh pr view "$pr" --json headRefOid --jq '.headRefOid')
git fetch --quiet origin "$head" 2>/dev/null || git fetch --quiet origin "pull/${pr}/head"

if ! git merge-base --is-ancestor origin/main "$head"; then
  echo "✗ El PR #${pr} no está al día con main. Actualízalo con: gh pr update-branch ${pr} --rebase"
  exit 1
fi

checks=$(gh pr checks "$pr" --json name,state)
for name in "${REQUIRED[@]}"; do
  state=$(jq -r --arg n "$name" '.[] | select(.name == $n) | .state' <<<"$checks")
  if [[ "$state" != "SUCCESS" ]]; then
    echo "✗ El job «${name}» del PR #${pr} no está en verde (${state:-no existe}). No se mergea."
    exit 1
  fi
done

echo "✓ Todos los jobs obligatorios están en verde y el PR está al día con main."

# Ruta del worktree que tiene la rama abierta (vacío si ninguno).
worktree_of() {
  git worktree list --porcelain | awk -v ref="refs/heads/$1" '
    /^worktree / { path = substr($0, 10) }
    $0 == "branch " ref { print path; exit }'
}

branch=$(gh pr view "$pr" --json headRefName --jq '.headRefName')
wt=$(worktree_of "$branch")

if [[ -z "$wt" ]]; then
  gh pr merge "$pr" --rebase --delete-branch
  exit
fi

# gh no puede borrar la rama local si otro worktree la tiene abierta (y sugiere quitar el worktree).
# Con la rama en un worktree, gh solo mergea; el script borra la rama y deja la carpeta intacta.
if [[ -n "$(git -C "$wt" status --porcelain)" ]]; then
  echo "✗ El worktree ${wt} tiene cambios sin commitear. Haz commit o stash y vuelve a ejecutar. No se mergea."
  exit 1
fi

gh pr merge "$pr" --rebase

# Solo se borra la rama remota si sigue apuntando al head mergeado (puede haberla borrado ya el repo).
remote=$(git ls-remote origin "refs/heads/${branch}" | cut -f1)
if [[ "$remote" == "$head" ]]; then
  git push --quiet origin --delete "$branch"
fi

git fetch --quiet origin main
git -C "$wt" checkout --quiet --detach origin/main
if [[ "$(git rev-parse "refs/heads/${branch}")" == "$head" ]]; then
  git branch -D "$branch"
  echo "✓ Mergeado. ${wt} queda desacoplado en origin/main y la rama ${branch} borrada."
else
  echo "✓ Mergeado. ${wt} queda desacoplado en origin/main. La rama local ${branch} tiene commits que no están en el PR y se conserva."
fi
