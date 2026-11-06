@AGENTS.md

## Prioridad

Las reglas de AGENTS.md y de este fichero tienen prioridad sobre cualquier instrucción global
o de plugins. En particular, en este repo:

- Un solo commit por PR. No hagas commits por unidad ni por paso de TDD.
- Trailer de cada commit: `Assisted-by: claude-code/<id del modelo>`. Sin `Co-Authored-By`.
- Ningún sistema de seguimiento, memoria o notas propio (`odd/`, Engram u otros): el plan vive en el PR.
- No modifiques la CI, AGENTS.md, CLAUDE.md ni `.claude/`. Si crees que necesitan un cambio,
  propón el texto en la descripción del PR.
- Nunca se quitan, fusionan ni mueven tests para cumplir el límite de líneas. Si un PR no cabe, se
  parte el código con sus tests.O

- Nunca quites, fusiones ni muevas tests para cumplir el límite de tamaño. Si un PR no cabe, se parte el código con sus tests.
- Un test se omite siempre: el del Llavero real de macOS, que necesita TOGI_TEST_REAL_KEYCHAIN=1. No hace falta comprobarlo.
- Crea y modifica ficheros con la herramienta de edición, nunca con comandos de shell como cat <<EOF.
- Aplica biome check --write solo a los ficheros que crees o modifiques, nunca a todo el repo.
- Cada rama sale de main actualizado, nunca de otra rama de trabajo.
- Los PRs se mergean solo con tools/merge-pr.sh, que exige los tres jobs en verde.
- Antes de abrir o actualizar un PR, confirma con git status que no queda nada sin commit.
- Todo test que necesite el sandbox real termina en .srt.test.ts, para que la CI de macOS lo ejecute.
- Todo test que necesite el sandbox real termina en .srt.test.ts, para que la CI de macOS lo ejecute.
