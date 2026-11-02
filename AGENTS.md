# AGENTS.md

Mapa para agentes que trabajan en este repo. Mantenerlo corto.

## Antes de cambiar nada
- Las decisiones de diseño están en `docs/adr/`. Son la fuente de verdad: si una tarea contradice un ADR, para y pregunta; no lo cambies por tu cuenta.
- El estado del proyecto, el plan y el backlog están en `docs/contexto.md`.

## Reglas
- TypeScript estricto sobre Node LTS, pnpm (ADR-002).
- `core` no depende de infraestructura (base de datos, git, red, agentes).
- La CLI solo habla con la API del daemon.
- Cambios pequeños: un objetivo por PR, idealmente menos de 300 líneas.
- No modifiques tests existentes ni la configuración de CI para que algo pase.
- Commits en conventional commits; si los hace un agente, con el trailer `Assisted-by: <agente>/<modelo>`.
