#!/usr/bin/env bash
# Mergea un PR solo si está abierto, sus jobs obligatorios están en verde y su rama está al día con main.
# Si va por detrás de main, lo actualiza con update-branch --rebase y espera a la CI del nuevo head.
# Uso: tools/merge-pr.sh [--auto] <número del PR>
#   --auto  activa el merge automático de GitHub (gh pr merge --auto) y termina sin esperar a la CI;
#           solo si los jobs obligatorios de la protección de main coinciden con REQUIRED.
# Esperas: MERGE_PR_POLL_SECONDS (20) entre consultas y MERGE_PR_MAX_POLLS (90) consultas como máximo.
set -euo pipefail

REQUIRED=("check (22.18.0)" "check (24.22.1)" "sandbox-macos" "rust")
POLL="${MERGE_PR_POLL_SECONDS:-20}"
MAX_POLLS="${MERGE_PR_MAX_POLLS:-90}"
auto=0
pr=""
for arg in "$@"; do
  if [[ "$arg" == "--auto" ]]; then auto=1; else pr="$arg"; fi
done
: "${pr:?Uso: tools/merge-pr.sh [--auto] <número del PR>}"

refresh() {
  git fetch --quiet origin main
  head=$(gh pr view "$pr" --json headRefOid --jq '.headRefOid')
  git fetch --quiet origin "$head" 2>/dev/null || git fetch --quiet origin "pull/${pr}/head"
}

is_up_to_date() { git merge-base --is-ancestor origin/main "$head"; }

# Deja en $bad_name/$bad_state el primer job obligatorio sin verde y $hard=1 si alguno ya ha fallado.
read_checks() {
  local checks name s
  bad_name="" bad_state="" hard=0
  checks=$(gh pr checks "$pr" --json name,state)
  for name in "${REQUIRED[@]}"; do
    s=$(jq -r --arg n "$name" '.[] | select(.name == $n) | .state' <<<"$checks")
    if [[ "$s" == "SUCCESS" ]]; then continue; fi
    if [[ -z "$bad_name" ]]; then
      bad_name=$name
      bad_state=$s
    fi
    case "$s" in
    "" | PENDING | QUEUED | IN_PROGRESS | WAITING | REQUESTED) ;;
    *)
      bad_name=$name
      bad_state=$s
      hard=1
      break
      ;;
    esac
  done
}

not_green() {
  echo "✗ El job «${bad_name}» del PR #${pr} no está en verde (${bad_state:-no existe}). $1"
  exit 1
}

# Compara los jobs obligatorios de la protección de main con REQUIRED; si difieren, se niega.
check_protection() {
  local prot mine only_req only_prot
  if ! prot=$(gh api "repos/{owner}/{repo}/branches/main/protection" --jq '(.required_status_checks.contexts // [])[]'); then
    echo "✗ No puedo leer la protección de main. No se activa el merge automático."
    exit 1
  fi
  prot=$(printf '%s\n' "$prot" | LC_ALL=C sort)
  mine=$(printf '%s\n' "${REQUIRED[@]}" | LC_ALL=C sort)
  only_req=$(LC_ALL=C comm -23 <(printf '%s\n' "$mine") <(printf '%s\n' "$prot"))
  only_prot=$(LC_ALL=C comm -13 <(printf '%s\n' "$mine") <(printf '%s\n' "$prot"))
  if [[ -z "$only_req$only_prot" ]]; then return; fi
  echo "✗ Los jobs obligatorios de la protección de main no coinciden con REQUIRED. No se activa el merge automático."
  if [[ -n "$only_req" ]]; then
    echo "  Faltan en la protección de main:"
    sed 's/^/    - /' <<<"$only_req"
  fi
  if [[ -n "$only_prot" ]]; then
    echo "  Faltan en REQUIRED (tools/merge-pr.sh):"
    sed 's/^/    - /' <<<"$only_prot"
  fi
  exit 1
}

state=$(gh pr view "$pr" --json state --jq '.state')
if [[ "$state" != "OPEN" ]]; then
  echo "✗ El PR #${pr} no está abierto (${state}). No hay nada que mergear."
  exit 1
fi

if ((auto)); then check_protection; fi

refresh
old_head=$head
updated=0
if ! is_up_to_date; then
  echo "… El PR #${pr} va por detrás de main: gh pr update-branch --rebase."
  gh pr update-branch "$pr" --rebase
  for ((i = 0; i < MAX_POLLS; i++)); do
    if [[ "$(gh pr view "$pr" --json headRefOid --jq '.headRefOid')" != "$old_head" ]]; then break; fi
    sleep "$POLL"
  done
  refresh
  if ! is_up_to_date; then
    echo "✗ El PR #${pr} no está al día con main tras update-branch. No se mergea."
    exit 1
  fi
  updated=1
fi

if ((auto)); then
  read_checks
  if ((hard)); then not_green "No se activa el merge automático."; fi
  gh pr merge "$pr" --auto --rebase
  echo "✓ Merge automático activado. No se limpia la rama local ni el worktree: el merge ocurre después."
  exit 0
fi

for ((i = 0; ; i++)); do
  read_checks
  if [[ -z "$bad_name" ]]; then break; fi
  # Sin update-branch no se espera: un job sin verde corta, como siempre.
  if ((hard || !updated || i >= MAX_POLLS)); then not_green "No se mergea."; fi
  echo "… Esperando a «${bad_name}» (${bad_state:-sin empezar})."
  sleep "$POLL"
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
# La rama local se borra si es el head mergeado o el que tenía el PR antes de update-branch.
tip=$(git rev-parse "refs/heads/${branch}")
if [[ "$tip" == "$head" || "$tip" == "$old_head" ]]; then
  git branch -D "$branch"
  echo "✓ Mergeado. ${wt} queda desacoplado en origin/main y la rama ${branch} borrada."
else
  echo "✓ Mergeado. ${wt} queda desacoplado en origin/main. La rama local ${branch} tiene commits que no están en el PR y se conserva."
fi
