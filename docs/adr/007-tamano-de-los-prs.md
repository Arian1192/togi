# ADR-007: Medición y límite de tamaño de los PRs

4 de noviembre de 2026 · Arian

## Estado y contexto

**Estado:** aprobado el 4 de noviembre de 2026.

Durante la rebanada 1, los PRs de este repo siguieron la regla de `AGENTS.md`: un objetivo por PR, idealmente de menos de 300 líneas. La regla consiguió lo que buscaba, PRs revisables, y detectó a tiempo las tareas que abarcaban demasiado. Pero los datos de la rebanada muestran que contaba mal:

- **Los tests inflaban la cifra.** Ocuparon entre la mitad y dos tercios de cada diff. Ejemplos: el decider, 157 líneas de código y 169 de tests; la cadena de hashes, 90 y 271; el event store, 175 y 186; el Llavero, 156 y 198.
- **Casi ningún PR cumplió su primera estimación**, siempre por los tests.
- **Muchos PRs se partieron en tres o cuatro trozos**, a veces dejando en `main` código sin usar o stubs temporales.
- **Dos veces un agente quitó o fusionó tests para cumplir la cifra.** La regla empujaba en contra de lo que se quiere fomentar.
- **Hubo inflación mecánica**: reindentaciones al refactorizar, y un cambio de tipo que atravesaba todas las capas.
- **Tres excepciones se decidieron a mano** (303, 304 y 341 líneas).

Revisar código de producción cuesta más que revisar tests, y lo que más importa acotar es lo que cambia el comportamiento.

## Decisión

Un PR de este repo se mide con `node tools/diff-size.mjs`, después de `git add`, en cuatro categorías: producción, tests (ficheros `*.test.*`, carpetas `testing/` y `packages/e2e/`), documentación (`*.md` y `docs/`) y lockfile. Los cambios de espacios no cuentan.

1. **Producción: como máximo 200 líneas cambiadas.** Es el límite principal.
2. **Total, con tests y documentación: como máximo 500.** Evita PRs imposibles de revisar aunque casi todo sean tests.
3. **Margen del 10% sin preguntar** (hasta 220 y 550), si el PR es una sola unidad coherente y lo declara en su descripción.
4. **Nunca se quitan, fusionan ni mueven tests para cumplir el límite.** Si un PR no cabe, se parte el código con sus tests, por una frontera en la que cada parte deje `main` en verde y con un comportamiento coherente.
5. **Los cambios mecánicos** que atraviesan capas (un cambio de tipo, un renombrado) pueden pasar del límite si se aprueban en el plan, con el motivo en la descripción del PR.
6. **El lockfile no cuenta.**

Las cifras de 200 y 500 son una propuesta basada en los PRs de la rebanada 1, no un estándar: con ellas, casi todos los PRs que se partieron habrían cabido enteros. Se revisan con los datos del piloto.

## Alcance

Esta decisión rige cómo se trabaja en este repo. El límite que el ADR-001 fija para las tareas que harán los agentes dentro de togi (`FlowPolicy.maxLines`) no cambia aquí: se decide en la rebanada 3, al construir el gate `diff_size`, probablemente con la misma forma de medir.

> **Nota (rebanada 2):** el gate 1 adelanta una parte. Desde la rebanada 2, `FlowPolicy` usa `maxProductionLines: 200` y `maxTotalLines: 500`, y el plan estima por separado producción y tests. Queda para la rebanada 3 el gate `diff_size`, que mide el diff real.

## Alternativas descartadas

| Alternativa | Por qué se descarta |
| --- | --- |
| Mantener 300 líneas en total | Penaliza los tests y empuja a quitarlos, como ya pasó dos veces. |
| Subir el total a 400 sin separar categorías | Sigue tratando igual un test que una línea de producción. |
| No contar los tests en absoluto | Un PR de 150 líneas de código y 900 de tests no se revisa bien. |
| Medir a ojo, como hasta ahora | Las estimaciones fallaron casi siempre; un script da la misma cifra a todos. |
