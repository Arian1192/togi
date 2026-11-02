# ADR-002: Lenguaje del daemon de forja

2 de noviembre de 2026 · Arian

## Estado y contexto

**Estado:** aprobado el 2 de noviembre de 2026.

forja es un daemon con API y una CLI que habla solo con esa API (ADR-001 y `docs/contexto.md`). El lenguaje debe cumplir cuatro requisitos:

- Integrarse bien con los runtimes de agente, que publican SDKs oficiales.
- Compartir tipos con la futura web UI en React.
- Desplegarse en un servidor cuando llegue el modo equipo.
- Ser productivo para un único desarrollador cuyo stack diario es TypeScript con Node y pnpm (`promos`).

La carga del daemon es de entrada/salida (procesos, git, red, base de datos), no de cálculo.

## Decisión

TypeScript en modo estricto sobre Node (versión LTS, como mínimo la 22 que exige `promos`), con pnpm.

- Los dos runtimes candidatos tienen SDK oficial en TypeScript: `@anthropic-ai/claude-agent-sdk` y `@openai/codex-sdk`. El de Codex requiere Node 18 o posterior ([docs](https://developers.openai.com/codex/sdk)).
- Node y no Bun: los SDKs documentan Node como entorno, y Bun añadiría riesgo de compatibilidad sin un beneficio claro para un daemon de entrada/salida. Opinión propia, revisable.
- Base de datos SQLite en local detrás de una interfaz de almacenamiento; el driver concreto se elige en el paso 5.

Estructura inicial del repo `forja`, un monorepo pnpm:

| Paquete | Contenido |
| --- | --- |
| `core` | Tipos de eventos y entidades, proyecciones del log, reglas del flujo (ADR-001). Sin dependencias de infraestructura. |
| `daemon` | API HTTP + SSE, almacenamiento, runtimes de agente, workspaces y gates. |
| `cli` | El comando `forja`; solo habla con la API del daemon. |
| `web` | Más adelante: la web UI en React, que reutiliza los tipos de `core`. |

El script `baseline.mjs` se queda fuera de los paquetes, en `tools/`.

## Alternativas descartadas

| Alternativa | A favor | Por qué se descarta |
| --- | --- | --- |
| Go | Un único binario fácil de distribuir; concurrencia excelente. | Sin SDKs oficiales de los runtimes: habría que lanzar los CLIs y parsear su salida. Tipos duplicados con la web UI. Stack nuevo. |
| Rust | Rendimiento; reutilizable dentro de Tauri. | Tauri no es prioritario. Coste de desarrollo alto para un daemon de entrada/salida. Mismos problemas de SDK que Go. |
| Bun | Arranque rápido; ejecutable único con `bun build --compile`. | Riesgo de compatibilidad con los SDKs, que documentan Node. |
| Python | El Agent SDK y el SDK de Codex tienen versión Python. | La web UI y el repo piloto son TypeScript: dos lenguajes en vez de uno. |

## Consecuencias

- Un solo lenguaje para `core`, daemon, CLI y web UI; el modelo de datos se define una vez.
- `core` no depende de infraestructura, así que las reglas del flujo se prueban sin base de datos, git ni agentes.
- Distribuir forja como un único ejecutable es incómodo en Node. No afecta al uso personal ni al despliegue en servidor; se resuelve si algún día se empaqueta como producto.
- Las versiones de los SDKs de agente se fijan de forma exacta: evolucionan rápido y un cambio de comportamiento afecta a los gates.
