# ADR-006: Cambio de nombre a togi

3 de noviembre de 2026 · Arian

## Estado y contexto

**Estado:** aprobado el 3 de noviembre de 2026.

El proyecto se llamaba `forja`. Tras la revisión de marca no se puede usar ese nombre. El nuevo nombre es **togi** (研ぎ), el pulido de espadas japonés; el artesano es el *togishi*. Encaja con lo que hace el sistema: no forja el código, lo afina y lo verifica por etapas hasta que está listo.

Se cambia ahora, antes del PR 5 de la rebanada 1, porque es el primer PR que crea datos en disco (`~/.forja`, variables de entorno, servicio del Llavero). Después, el cambio exigiría migrar datos reales.

## Decisión

- Nombre del producto, del repo y del binario de la CLI: `togi`.
- Paquetes del monorepo: `@togi/core`, `@togi/daemon` y `@togi/cli`. Si se publica en npm, con scope (`@arian1192/togi`).
- Directorio de datos: `~/.togi`. Variables de entorno: `TOGI_HOME` y `TOGI_KEYCHAIN`.
- Los ADR-001 a ADR-005, `docs/contexto.md`, `docs/plan-rebanada-1.md`, `README.md` y `AGENTS.md` se actualizan al nuevo nombre. Aunque los ADRs son registros históricos, los agentes los leen antes de cada PR e implementan lo que dicen; este ADR deja constancia del cambio y su fecha.
- El nombre, el prefijo de las variables de entorno y el directorio de datos se definen en una sola constante del daemon, para que un cambio futuro de nombre sea trivial.

## Comprobaciones hechas (3 de noviembre de 2026)

| Comprobación | Resultado |
| --- | --- |
| npm | `togi`, `togi-cli`, `@togi/core` y `@togi/cli` no existen. No se ha podido comprobar si el scope `@togi` está reservado. |
| GitHub | Existe [JoelLarson/togi](https://github.com/JoelLarson/togi): proyecto personal en Go, mismo nicho y misma metáfora, 0 estrellas. Riesgo de confusión en búsquedas y de choque de binarios en el `PATH`. |
| Marca TOGI de Togi Inc. | Registro internacional de Madrid [1689960](https://www3.wipo.int/madrid/monitor/es/), activo hasta 2032, clases 9, 35, 42 y 44. Base en Corea; designa solo Japón, Tailandia, Estados Unidos y Vietnam. No designa la UE ni España. |

## Riesgos y pendientes

- La marca de Togi Inc. no afecta al uso en la UE, pero sí a una distribución futura en Estados Unidos, Japón, Corea, Tailandia o Vietnam, en las mismas clases de software. Se revisa si el producto sale de la UE.
- Pendiente: búsqueda en TMview de otras marcas "TOGI" o parecidas en la UE y España (clases 9 y 42), y búsqueda fonética con un agente de la propiedad industrial antes de invertir en la marca.

## Alternativas descartadas

| Alternativa | Por qué se descarta |
| --- | --- |
| Mantener `forja` | No se puede usar el nombre. |
| Cambiar el nombre después de la rebanada 1 | Habría que migrar `~/.forja`, las variables de entorno y el servicio del Llavero con datos reales. |
| Dejar los ADRs antiguos con el nombre viejo | Los agentes implementarían lo que dicen: `FORJA_HOME`, `~/.forja`. |
