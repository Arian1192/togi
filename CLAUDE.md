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
