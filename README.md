# togi

togi es una software factory local: agentes de código trabajan en un flujo con gates automáticos y aprobación humana en los puntos críticos. Su nombre viene del *togi* (研ぎ), el pulido de espadas japonés: no forja el código, lo afina y lo verifica por etapas hasta que está listo.

> **Estado:** rebanada 1 en curso. Ya funcionan el daemon y los comandos para crear, consultar y enviar tareas. Todavía no hay agentes: llegan en la rebanada 2.

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

## Comandos

| Comando | Qué hace |
| --- | --- |
| `togi daemon start \| stop \| status` | Arranca, detiene o consulta el daemon |
| `togi task new "<título>" --risk <low\|medium\|high> --repo <owner/repo>` | Crea una tarea en `draft` |
| `togi task show <n>` | Muestra el detalle de una tarea |
| `togi status [--state <estado>] [--all]` | Lista las tareas, primero las que esperan una decisión tuya |
| `togi task submit <n>` | Envía la tarea a planificación |

Todos aceptan `--json` y `--help`. Los códigos de salida y el formato de los mensajes están en [`docs/cli-estilo.md`](docs/cli-estilo.md).

Pendientes en la rebanada 1: `togi task reject`, `togi task edit`, `togi watch` y `togi admin verify-log`.

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

Cómo se trabaja en este repo:

- Un objetivo por PR, idealmente de menos de 300 líneas, con un solo commit.
- Se mergea solo por rebase, para conservar el trailer `Assisted-by` en `main`.
- Los agentes siguen [`AGENTS.md`](AGENTS.md) y [`CLAUDE.md`](CLAUDE.md).
- El plan de trabajo actual está en [`docs/plan-rebanada-1.md`](docs/plan-rebanada-1.md).

## Documentación

- [`docs/contexto.md`](docs/contexto.md): investigación y decisiones del proyecto.
- [`docs/adr/`](docs/adr/): ADR-001 (flujo de tareas), 002 (monorepo), 003 (runtime de agentes), 004 (modelo de datos), 005 (API y CLI), 006 (cambio de nombre).
- [`docs/cli-estilo.md`](docs/cli-estilo.md): guía de estilo de la CLI.
- [`docs/plan-rebanada-1.md`](docs/plan-rebanada-1.md): plan de la rebanada 1.
