# togi

Software factory con IA: un daemon headless con API que lleva cada tarea por un flujo con gates automáticos y aprobación humana (plan → construcción → verificación → revisión → merge), con agentes de código haciendo el trabajo.

Estado: diseño. Aún no hay código del daemon.

## Documentación

- [Contexto y estado del proyecto](docs/contexto.md)
- [ADR-001: Flujo de tareas](docs/adr/001-flujo-de-tareas.md)
- [ADR-002: Lenguaje del daemon](docs/adr/002-lenguaje-del-daemon.md)
- [ADR-003: Runtime del agente](docs/adr/003-runtime-del-agente.md)
- [ADR-004: Modelo de datos](docs/adr/004-modelo-de-datos.md)
- [ADR-005: API y CLI de la rebanada 1](docs/adr/005-api-y-cli-rebanada-1.md)
- [ADR-006: Cambio de nombre a togi](docs/adr/006-cambio-de-nombre.md)
## Herramientas

- `tools/baseline.mjs`: línea base de métricas a partir de los PRs de un repo (requiere Node ≥ 22 y `gh` autenticado).

```bash
node tools/baseline.mjs --repo Arian1192/promos --base dev --since 2026-11-02 --json baseline-dev.json
```
