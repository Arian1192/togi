#!/usr/bin/env bash
# Rebanada 2 de extremo a extremo, manual y con el modelo real (PR 17). La versión de la CI, con un
# agente falso en el sandbox real, es packages/e2e/src/slice2.srt.test.ts.
#
# Uso: tools/slice2-manual.sh <togi_home>
#   <togi_home> es una carpeta de datos de togi solo para esta prueba, con su propia credencial:
#     TOGI_HOME=<togi_home> togi auth status     (y, si no hay, pbpaste | TOGI_HOME=... togi auth set-api-key)
#
# Recorre: registrar un repo de prueba, crear y enviar una tarea, ver el plan v1, pedir cambios, ver
# el v2 y aprobarlo. Imprime solo estados y versiones; nunca la credencial ni el contenido del plan.
# Sale con 0 si la tarea acaba en building con el plan v2 aprobado.
set -euo pipefail
set +x

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TOGI=(node "$ROOT/packages/cli/bin/togi.js")
REPO_NAME="togi-e2e/demo"
WAIT_SECONDS="${E2E_WAIT_SECONDS:-900}"

: "${1:?Uso: tools/slice2-manual.sh <togi_home>}"
export TOGI_HOME="$1"
mkdir -p "$TOGI_HOME"

if ! "${TOGI[@]}" auth status >/dev/null 2>&1; then
  echo "✗ No hay credencial en $TOGI_HOME. Guárdala antes:"
  echo "  pbpaste | TOGI_HOME=$TOGI_HOME togi auth set-api-key"
  exit 1
fi

repo=$(mktemp -d)
cleanup() {
  "${TOGI[@]}" repo remove "$REPO_NAME" >/dev/null 2>&1 || true
  "${TOGI[@]}" daemon stop >/dev/null 2>&1 || true
  rm -rf "$repo"
}
trap cleanup EXIT

printf '# demo\n\nUna utilidad que convierte un texto en slug.\n' >"$repo/README.md"
git -C "$repo" init -q -b main
git -C "$repo" remote add origin "git@github.com:$REPO_NAME.git"
git -C "$repo" add .
git -C "$repo" -c user.name=togi -c user.email=togi@localhost commit -q -m "repo de prueba"

"${TOGI[@]}" daemon start >/dev/null
"${TOGI[@]}" repo add "$REPO_NAME" --path "$repo" >/dev/null
created=$("${TOGI[@]}" task new "Función slug" --risk low --repo "$REPO_NAME" --base main \
  --description "Añade una función slug() en src/slug.ts con su test." \
  --criteria "slug('Hola Mundo') devuelve 'hola-mundo'.")
number=$(grep -oE '#[0-9]+' <<<"$created" | head -1 | tr -d '#')

# Espera a que la tarea salga de planning; imprime su estado.
wait_plan() {
  local state=planning waited
  for ((waited = 0; waited < WAIT_SECONDS; waited += 15)); do
    state=$("${TOGI[@]}" task show "$number" | sed -n 2p | awk '{print $1}')
    [[ "$state" != planning ]] && break
    sleep 15
  done
  echo "$state"
}
version() { "${TOGI[@]}" plan show "$number" | sed -n 1p | grep -oE 'versión [0-9]+'; }

"${TOGI[@]}" task submit "$number" >/dev/null
echo "… #$number enviada al planificador real."
[[ "$(wait_plan)" == plan_review ]] || { echo "✗ El plan v1 no llegó."; exit 1; }
echo "✓ Plan: $(version)"

"${TOGI[@]}" plan request-changes "$number" --category scope \
  --reason "Añade también un test para una cadena vacía." >/dev/null
echo "… Cambios pedidos."
[[ "$(wait_plan)" == plan_review ]] || { echo "✗ El plan v2 no llegó."; exit 1; }
echo "✓ Plan: $(version)"

"${TOGI[@]}" plan approve "$number" >/dev/null
state=$("${TOGI[@]}" task show "$number" | sed -n 2p | awk '{print $1}')
echo "Estado final: $state"
[[ "$state" == building ]] || { echo "✗ La tarea no quedó en building."; exit 1; }
echo "✓ Recorrido completo: v1, cambios, v2 aprobado y la tarea en building."
