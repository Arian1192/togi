# togi

togi es una software factory local: agentes de código trabajan en un flujo con gates automáticos y aprobación humana en los puntos críticos. Su nombre viene del *togi* (研ぎ), el pulido de espadas japonés: no forja el código, lo afina y lo verifica por etapas hasta que está listo.

> **Estado:** rebanada 1 terminada. Funcionan el daemon y todos los comandos para gestionar tareas, seguir el log en directo y verificar que nadie lo ha manipulado. Todavía no hay agentes: llegan en la rebanada 2.

## Cómo funciona

```
draft → planning → plan_review → building → verifying → review → merged
          (gate 1: apruebas el plan)            (gate 2: apruebas el PR)
```

- **Un daemon local** guarda cada cambio como un evento en un log que detecta manipulaciones (cadena de hashes) y expone una API en un socket Unix con autenticación por token.
- **Los textos de las tareas van cifrados** fuera del log. Borrar un dato es destruir su clave: el log sigue intacto y verificable.
- **La CLI `togi` es un cliente más** de esa API: nunca abre la base de datos.

Las decisiones de diseño están en los ADRs de [`docs/adr/`](docs/adr/).

## Requisitos

- macOS (el daemon guarda su clave maestra en el Llavero). Linux y Windows no están soportados todavía.
- Node.js 22.18 o posterior.
- pnpm, en la versión fijada en `package.json`.

## Probar togi

Desde la raíz del repo:

```bash
pnpm install
alias togi="node $PWD/packages/cli/bin/togi.js"
```

Para una prueba sin tocar tus datos ni tu Llavero, usa una carpeta temporal y el keychain en fichero (solo para pruebas):

```bash
export TOGI_HOME=$(mktemp -d) TOGI_KEYCHAIN=file
```

Y después:

```bash
togi daemon start
togi task new "Filtro por fecha" --risk low --repo owner/repo --criteria "Solo salen los envíos del rango"
togi status
togi task show 1
togi task submit 1
togi daemon stop
```

Sin `TOGI_HOME` ni `TOGI_KEYCHAIN`, togi usa `~/.togi` y el Llavero de macOS.

## El Llavero y tus datos

togi cifra con AES-256-GCM los textos de cada tarea (título, descripción y criterio de aceptación) y los guarda fuera del log. Las claves funcionan en dos niveles:

- **Una clave de datos por tarea y tipo de texto**, guardada en la base de datos, pero cifrada a su vez con la clave maestra.
- **Una clave maestra de 32 bytes**, guardada en el Llavero de macOS, nunca en `~/.togi`. Quien copie esa carpeta se lleva los datos cifrados, pero no la clave para abrirlos.

Cómo se gestiona la clave maestra:

- **Se crea en el primer `togi daemon start`.** Cada `TOGI_HOME` tiene la suya: la cuenta del Llavero incluye un identificador de la ruta.
- **Nunca se sobrescribe.** Si togi no puede leerla porque el Llavero está bloqueado o falla, el daemon no arranca. Nunca crea una clave nueva en su lugar, porque eso dejaría ilegibles todos los textos.
- **No pasa por los argumentos de ningún proceso**, donde otro programa podría verla: se entrega al comando `security` por su entrada estándar.
- **Puedes verla o borrarla** con la app Acceso a Llaveros, buscando `togi`.

`TOGI_KEYCHAIN=file` guarda la clave maestra en un fichero dentro de `TOGI_HOME`, junto a los datos. Solo sirve para pruebas: sin el Llavero, la clave no está protegida.

**Si pierdes la clave maestra, pierdes los textos de todas las tareas.** El log sigue íntegro y verificable, pero los títulos, descripciones y criterios ya no se pueden descifrar. Si haces copias de seguridad de `~/.togi`, guarda también la del Llavero.

Borrar un texto es destruir su clave de datos (`erase`). Tiene un límite: una copia de seguridad hecha antes del borrado, por ejemplo con Time Machine, conserva la clave de datos cifrada, y mientras exista la clave maestra se podría recuperar. Está documentado en el [ADR-004](docs/adr/004-modelo-de-datos.md).

## Comandos

| Comando | Qué hace |
| --- | --- |
| `togi daemon start \| stop \| status` | Arranca, detiene o consulta el daemon |
| `togi task new "<título>" --risk <low\|medium\|high> --repo <owner/repo>` | Crea una tarea en `draft` |
| `togi task show <n>` | Muestra el detalle de una tarea |
| `togi status [--state <estado>] [--all]` | Lista las tareas, primero las que esperan una decisión tuya |
| `togi task submit <n>` | Envía la tarea a planificación |
| `togi task reject <n> --category <categoría> --reason <texto> [--yes]` | Rechaza una tarea; pide confirmación |
| `togi task edit <n> [--title …] [--description …] [--criteria …]` | Edita una tarea en `draft`; sin flags, abre `$EDITOR` |
| `togi watch [--from-start]` | Sigue los eventos del log en directo; reconecta si el daemon se reinicia |
| `togi admin verify-log` | Comprueba que el log no se ha manipulado |

Todos aceptan `--json` y `--help`. Los códigos de salida y el formato de los mensajes están en [`docs/cli-estilo.md`](docs/cli-estilo.md).

`togi task edit` sin flags abre `$VISUAL` o `$EDITOR` con una plantilla. Las líneas que empiezan por `#togi` son comentarios y cabeceras de sección; el resto, incluido el Markdown, es texto. Guardar el fichero vacío cancela. El editor se lanza sin shell, así que una ruta con espacios no funciona. El texto se edita en un fichero temporal privado que se borra al terminar, pero algunos editores guardan copias propias fuera de esa carpeta.

## Desarrollo

```bash
pnpm typecheck
pnpm lint
pnpm test
```

El monorepo tiene tres paquetes:

| Paquete | Contenido |
| --- | --- |
| `packages/core` | Modelo, reglas del flujo y cadena de hashes. Sin infraestructura |
| `packages/daemon` | Event store en SQLite, cifrado, proyecciones y API |
| `packages/cli` | La CLI `togi` |
| `packages/e2e` | El test de extremo a extremo, que usa togi como una persona |

Cómo se trabaja en este repo:

- Un objetivo por PR, con un solo commit. Como máximo 200 líneas de producción y 500 en total, medidas con `node tools/diff-size.mjs` ([ADR-007](docs/adr/007-tamano-de-los-prs.md)). Nunca se quitan tests para cumplir el límite.
- Se mergea solo por rebase, para conservar el trailer `Assisted-by` en `main`.
- Los agentes siguen [`AGENTS.md`](AGENTS.md) y [`CLAUDE.md`](CLAUDE.md).
- El plan de la rebanada 1, ya completado, está en [`docs/plan-rebanada-1.md`](docs/plan-rebanada-1.md).

## Documentación

- [`docs/contexto.md`](docs/contexto.md): investigación y decisiones del proyecto.
- [`docs/adr/`](docs/adr/): ADR-001 (flujo de tareas), 002 (monorepo), 003 (runtime de agentes), 004 (modelo de datos), 005 (API y CLI), 006 (cambio de nombre), 007 (tamaño de los PRs).
- [`docs/cli-estilo.md`](docs/cli-estilo.md): guía de estilo de la CLI.
- [`docs/plan-rebanada-1.md`](docs/plan-rebanada-1.md): plan de la rebanada 1, completado.
