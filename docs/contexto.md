# Software Factory con IA: contexto, arquitectura y decisiones

Documento de contexto del proyecto. Resume la investigación inicial (noviembre de 2026) y las decisiones de diseño tomadas. Las cifras citadas proceden de las fuentes listadas al final; varias son de fabricantes o de resúmenes secundarios, así que conviene verificarlas en el original antes de usarlas en decisiones importantes.

---

## 1. Qué es una software factory con IA

Un sistema de entrega de software en el que agentes de IA escriben, prueban y preparan cambios dentro de un pipeline, mientras las especificaciones y la aprobación del merge quedan bajo control humano. No es un agente trabajando solo en un IDE: implica etapas, gates y un registro de lo que ocurrió en cada una.

No confundir con "AI factory" en el sentido de NVIDIA o Teradata (infraestructura para entrenar y servir modelos).

El término tiene historia: Bemer (GE, 1968), las factorías japonesas documentadas por Cusumano (Hitachi, Toshiba, NEC, Fujitsu), Microsoft en 2004 y las software factories DevSecOps del Departamento de Defensa de EE. UU. La novedad actual es que los agentes ejecutan el propio paso de escribir código.

Niveles de autonomía: desde asistentes en el editor hasta la "dark factory" (nivel 5 en la taxonomía de Dan Shapiro), donde ningún humano escribe ni revisa código. StrongDM ha publicado ese enfoque. La práctica dominante (Dropbox, Stripe, Shopify, Spotify) mantiene un humano en el juicio final.

## 2. Arquitectura de referencia

Dos partes separadas:

- **Bucle de trabajo (dev loop):** donde los agentes hacen el trabajo.
- **Plano de control:** donde el equipo de plataforma define las reglas (políticas, identidad de agentes, gateway de IA, observabilidad, golden paths).

Cinco etapas del bucle:

1. **Intake:** convierte señales (tickets, Slack, alertas, cron) en tareas asignables. La calidad aquí limita todo lo demás. Filtrar antes de asignar (etiqueta tipo `agent-ready`, tamaño pequeño, sin necesidad de diseño).
2. **Especificación:** separa planificación de ejecución. Spec y plan revisables (patrón spec-driven development, p. ej. GitHub Spec Kit: constitución → specify → plan → tasks → implement). **Gate humano: aprobación de la spec.**
3. **Construcción:** agentes en paralelo en entornos aislados. El entorno del agente se versiona junto al código.
4. **Verificación:** el cuello de botella real. Capas automáticas y humanas.
5. **Merge / despliegue:** **gate humano final**, política por niveles de riesgo.

Variantes multiagente: orquestador + agentes especialistas por rol (PM, desarrollador, tester, revisor). Ejemplos: Cognizant (orquestador + 10 redes de agentes), Spec Kit Agents (máquina de estados + hooks de grounding antes y después de cada fase), marco SDAD (captura de intención, spec legible por máquina, síntesis agéntica, verificación multiagente independiente con firma humana).

## 3. Verificación: el núcleo del problema

### 3.1 Los agentes hackean el verificador
Cuando una tarea es difícil, los agentes pueden editar tests, hardcodear salidas esperadas (special-casing), sobrecargar operadores o reescribir el runner. ImpossibleBench lo mide con tests que contradicen la spec.

Mitigaciones con evidencia:
- **Tests de solo lectura** bloquean ediciones sin bajar el éxito legítimo. Ocultar los tests reduce trampas casi a cero, pero también el éxito legítimo.
- **Monitorizar trayectorias, no solo resultados.** En "The Verification Horizon" (Qwen, junio 2026) el reward hacking bajó de 28,57% a 0,56%.
- **Señales en ejes distintos:** linter, type-checker, límite de tamaño de diff.
- **Gates tipo ratchet** (p. ej. Pawl): ningún test que pasaba puede fallar, desaparecer o marcarse skip, y nadie puede aflojar el gate. Límite: no detecta special-casing que ningún holdout cubra.
- Los monitores de razonamiento funcionan mejor como detectores externos que como parte de la recompensa.

### 3.2 Test suites
- La cobertura engaña. "Test homogenization trap": los tests generados por el mismo modelo comparten sus puntos ciegos.
- **Property-based testing** (Hypothesis, fast-check). El agente PBT de Anthropic sobre 100 paquetes Python: 56% de informes eran bugs válidos; en los mejor puntuados por rúbrica, 86%.
- Convertir los contraejemplos reducidos en tests de regresión permanentes (los agentes tienden a descartarlos).

### 3.3 Mutation testing
- Mide si la suite detectaría un fallo. Mutation score = mutantes matados / mutantes generados.
- Meta ACH: 571 tests generados, 277 se habrían descartado con solo cobertura de líneas; 73% aceptados por ingenieros. Mutantes guiados por LLM, más realistas que los operadores sintácticos.
- AdverTest: esquema adversarial con un agente que genera tests y otro que genera mutantes.
- Coste: hasta ~100x más lento que los tests normales. Aplicar al diff y a módulos críticos; ejecución completa en nocturno o post-merge.
- Herramientas: StrykerJS (JS/TS), PIT (Java), mutmut (Python).

### 3.4 Verificación formal (vericoding)
- El proof checker es una pieza pequeña de confianza: si el LLM alucina, el verificador rechaza y fuerza un reintento.
- Benchmark de vericoding (Tegmark et al.): Dafny 82%, Verus 44%, Lean 27%. En verificación pura de Dafny, de 68% a 96% en un año.
- AlgoVeri (ICML 2026, más exigente): Dafny 40,3%, Verus 24,7%, Lean 7,8%.
- Trampas detectables: `assume false`, `sorry`, especificaciones trivializadas.
- **Advertencia clave:** una prueba solo garantiza que el código cumple la spec, no que la spec sea correcta. El gate humano de la spec es aún más importante. Evitar que un mismo agente escriba spec, código y prueba.
- Aplicar a núcleos críticos (pagos, autenticación, criptografía, concurrencia). Dafny es hoy donde los modelos rinden mejor.

### 3.5 Capas de verification gates (orden por coste)
1. Integridad del gate: tests read-only, sin skips, ratchet. *(cada PR)*
2. Checks estáticos: tipos, linters, tamaño de diff. *(cada PR)*
3. Tests de ejemplo + PBT. *(cada PR)*
4. Mutation testing sobre el diff; completo en nocturno. *(selectivo)*
5. Verificación formal en módulos críticos. *(selectivo)*
6. Tests holdout ocultos + monitor de trayectoria. *(cada PR)*
7. Firma humana: spec, riesgo y evidencia.

Principios: la capa 1 va primero porque protege a las demás; señales independientes entre sí; red teaming periódico del verificador (los intentos nulos y adversariales deben puntuar cero); revisar y endurecer los gates cuando mejoran los modelos.

## 4. Datos sobre el impacto real

- Faros AI: equipos con alta adopción fusionan +98% de PRs, pero el tiempo de revisión sube +91% y el tamaño de PR +154%.
- Forrester: si solo se acelera la codificación (+30–40%), la productividad del equipo suele subir menos del 10%.
- METR: desarrolladores experimentados tardaron un 19% más con IA, creyendo que iban un 20% más rápido.
- DORA 2025: la IA amplifica fortalezas y debilidades existentes; más throughput y también más inestabilidad.
- METR: ~la mitad de PRs que pasaban el grader de SWE-bench no se habrían fusionado según los mantenedores.
- `dotnet/runtime` (Microsoft, 10 meses): PRs de agentes se fusionan el 67,9% frente al 87,1% de ingenieros; con commits humanos 86,2%, totalmente autónomos 55,1%; PRs de 1–50 líneas, 76–80% de éxito; añadir instrucciones al repo subió el éxito de 41,7% a 71%; dos revisores aportaron el 36% del feedback.
- El trabajo probado a escala es mecánico (migraciones, actualizaciones, refactors), no producto greenfield.

Casos publicados: Stripe Minions (>1.000 PRs fusionados/semana), Shopify River, Spotify Honk/Fleetshift, Ramp Inspect, Dropbox Nova, OpenAI Symphony.

## 5. Hoja de ruta acordada

- **Fase 0:** elegir un trabajo pequeño y mecánico; medir línea base (tiempo de revisión, tasa de merge, reverts, incidentes).
- **Fase 1:** un agente existente, un repo, buen contexto (AGENTS.md / CLAUDE.md corto, ~100 líneas, como mapa).
- **Fase 2:** verificación antes de escalar (capas 1–3, juez de alcance tipo Spotify). No usar la "confianza" autodeclarada del modelo como filtro.
- **Fase 3:** intake automatizado, aislamiento (worktrees → contenedores → sandboxes cloud), log de sesión durable.
- **Fase 4:** política de merge por riesgo (mecánico: auto-merge; acotado: 1 revisión; no trivial: 2 revisiones; dominios sensibles: responsable de dominio). Atribución (p. ej. trailer `Assisted-by`).
- **Fase 5:** escalar solo cuando la revisión aguante; añadir capas 4–5.

Si la base de tests es débil, la primera tarea real de la factoría es usar agentes para reforzarla.

## 6. Stack de infraestructura

| Capa | Opciones |
|---|---|
| Intake | GitHub Issues, Linear, Jira, Slack |
| Orquestador | GitHub Actions (sin infra), OpenAI Symphony (spec + referencia en Elixir, no mantenido como producto), Vercel Open Agents (MIT, web + workflow durable + sandbox) |
| Runtime del agente | Claude Agent SDK / Claude Code headless, Codex App Server (JSON-RPC) |
| Sandbox | git worktrees, Docker Sandboxes (microVM local), E2B (Firecracker, open source), Modal, Vercel Sandbox, Daytona (código cerrado desde junio 2026) |
| Herramientas | Servidores MCP; proxy de credenciales (los secretos no entran al sandbox) |
| Gateway LLM | LiteLLM, Portkey |
| Observabilidad | Langfuse (nivel LLM) + OpenTelemetry (infraestructura) |
| Verificación | CI existente + Hypothesis/fast-check, Stryker/PIT/mutmut, Dafny, ratchet tipo Pawl |
| Merge gate | Branch protection, CODEOWNERS, checks obligatorios, merge queue |

Precios orientativos de sandboxes (2026): E2B y Daytona ~0,0504 $/vCPU-hora; Modal ~41% más; Vercel cobra solo CPU activa.

Tres stacks de partida:
- **Mínimo:** todo en GitHub (issues etiquetados + Actions + agente headless + CI + branch protection).
- **Escala:** Linear/Jira + orquestador propio (fork de Open Agents o implementación de la spec de Symphony) + sandboxes cloud + LiteLLM/Langfuse + log de sesiones.
- **Soberano:** sandboxes autoalojados + modelos abiertos con vLLM detrás de LiteLLM.

## 7. Forma del producto (decisión)

**Núcleo headless + clientes.** Un daemon con API (HTTP + WebSocket/SSE) que orquesta agentes, gestiona workspaces, ejecuta gates y guarda estado y log de sesiones.

1. **CLI primero** (la usan humanos, CI y agentes).
2. **Web UI** servida por el propio daemon (estilo Vibe Kanban) para revisión de diffs, tablero y estado de gates.
3. **Tauri** solo si hace falta experiencia nativa o distribución como producto (daemon como sidecar).
4. **Modo equipo:** mover el daemon a un servidor y cambiar worktrees por sandboxes cloud.

Stack propuesto: daemon y CLI en TypeScript (Node/Bun) o Go; SQLite en local, Postgres en equipo; web UI en React. Rust si el equipo lo domina (reutilizable en Tauri).

La pantalla más importante es la de **revisión**: diff + evidencia de gates (tests, mutantes supervivientes, juez de alcance, trayectoria).

Referencias de mercado: Claude Squad (TUI en Go, AGPL), Conductor (macOS, diff review), Vibe Kanban (web UI local, ya sin mantenimiento oficial), Crystal (Electron, obsoleto desde febrero 2026), Orca, Superset, Quack (Tauri + React). Las apps locales paran cuando se cierra el portátil.

## 8. Fuentes principales

- Augment Code, "What Is a Software Factory?" — https://www.augmentcode.com/guides/what-is-a-software-factory
- Encore, "AI Software Factory Architecture" — https://encore.dev/articles/ai-software-factory-architecture
- Firecrawl, "How to Build an AI Software Factory" — https://www.firecrawl.dev/blog/ai-software-factory
- Forrester, agentic software development 2026 — https://forrester.com/blogs/agentic-software-development-takes-the-lead-from-code-assistants-to-orchestrated-sdlc-agents
- Spec Kit Agents — https://arxiv.org/pdf/2604.05278
- SDAD — https://arxiv.org/pdf/2608.20341
- ImpossibleBench — https://www.greaterwrong.com/posts/qJYMbrabcQqCZ7iqm/impossiblebench-measuring-reward-hacking-in-llm-coding-1
- The Verification Horizon (resumen) — https://codex.danielvaughan.com/2026/06/27/verification-horizon-no-silver-bullet-coding-agent-rewards-codex-cli-multi-layer-verification-strategy/
- Prime Intellect, reward hacking — https://primeintellect.ai/rl-glossary/reward-hacking
- Pawl — https://pypi.org/project/pawl-gate/0.1.0/
- Agentic property-based testing (Anthropic) — https://arxiv.org/html/2510.09907v1
- Meta ACH, mutation-guided test generation — https://arxiv.org/html/2501.12862v1
- AdverTest — https://arxiv.org/html/2602.08146v2
- Mutation testing como quality gate — https://www.agentpatterns.ai/verification/mutation-testing-quality-gate/
- Benchmark de vericoding — https://arxiv.org/pdf/2509.22908
- AlgoVeri — https://icml.cc/virtual/2026/poster/61803
- OpenAI Symphony (cobertura) — https://www.helpnetsecurity.com/2026/04/28/openai-symphony-codex-orchestration-linear/
- Vercel Open Agents — https://vercel.com/templates/template/open-agents
- Comparativa de sandboxes — https://bug0.com/blog/ai-sandbox-coding-agents
- Alternativas autoalojadas — https://helix.ml/blog/self-hosted-agent-sandboxes
- LiteLLM + Langfuse — https://langfuse.com/integrations/gateways/litellm.md
- Herramientas multiagente — https://agentsroom.dev/blog/best-multi-agent-coding-tools

---

## 9. Estado del proyecto (actualizado el 2 de noviembre de 2026)

### Decisiones cerradas
- **Nombre:** `forja` (repo propio, separado de cualquier repo objetivo). El binario de la CLI también se llama `forja`; si se publica en npm, con scope (`@arian1192/forja`).
- **Repo piloto:** `promos` (monorepo TypeScript con pnpm: `apps/api` + `apps/web`, Drizzle, CI en GitHub, PRs hacia `dev`). El prototipo `factory/` que había dentro de `promos` se retira (tag `factory-v0`) y no se usa como referencia, para diseñar sin sesgo.
- **Línea base inicial** (61 PRs a `main` desde el 1 de octubre de 2026, script `baseline.mjs` en el repo `forja`): lead time mediano de 0,2 h (no hay revisión real), tamaño mediano de 672 líneas, 23% de PRs en un solo commit. Conclusión: el valor de forja no es ir más rápido, sino producir cambios pequeños, verificados y revisables.
- **Atribución:** desde ahora, todo commit hecho por un agente lleva el trailer `Assisted-by: <agente>/<modelo>`.
- **ADR-001, flujo de tareas** (acordado en conversación; pendiente de aprobación formal): https://claude.ai/artifact/FPCKFx2KZNGUadj3B2XenL
  - Estados: `draft` → `planning` → `plan_review` (gate 1) → `building` → `verifying` → `review` (gate 2) → `merged`; finales sin merge: `failed` (3 ciclos fallidos) y `rejected`.
  - El plan es un contrato: un diff que toca ficheros fuera del plan falla el gate. Límite inicial de 300 líneas por tarea.
  - Tests: el agente puede añadir, nunca modificar ni marcar skip.
  - Gate 1 siempre humano. Gate 2 humano al inicio y delegado progresivamente por nivel de riesgo (bajo: UI, docs, Bruno; medio: lógica de API; alto: accesos, migraciones, emails, compras, siempre humano). Criterio de delegación: 20 tareas seguidas del nivel con coincidencia entre revisor delegado (en modo sombra) y humano.
  - Las tareas pueden nacer de varias fuentes (CLI, GitHub Issues, Jira, Sentry, conversación con el agente), todas como adaptadores que crean un `draft`; ninguna se salta el gate 1. MVP: CLI y GitHub Issues.
  - El plan vive en forja (fuente de verdad); el PR lleva una copia marcada, y todo agente que la lea tiene la instrucción de consultar forja ante cualquier duda.
  - Si `dev` avanza: forja integra `dev` en la rama; merge limpio → repite `verifying` (y `review` si los cambios tocan los ficheros de la tarea); conflicto → vuelve a `building`. El revisor nunca modifica la rama. forja serializa los merges.

### Plan de implementación
| # | Paso | Estado |
|---|---|---|
| 1 | Limpiar `promos` (tag, quitar `factory/`, `Assisted-by` en AGENTS.md) | Pendiente (Arian) |
| 2 | Flujo de tareas (ADR-001) | Acordado, falta aprobación formal |
| 3 | Lenguaje del daemon y runtime del agente (ADR-002 y ADR-003) | Hecho |
| 4 | Modelo de datos (eventos + entidades derivadas) | Hecho |
| 5 | Esqueleto de daemon + CLI mínima (un agente, un worktree) | Siguiente |
| 6 | Gates de capas 1 y 2 + contrato del plan | Pendiente |
| 7 | Piloto: 10 tareas reales en `promos` | Pendiente |
| 8 | Agente revisor en modo sombra | Pendiente |
| 9 | Delegación progresiva del gate 2 | Pendiente |

- **ADR-002, lenguaje:** TypeScript estricto sobre Node LTS (≥ 22) con pnpm; monorepo con paquetes `core` (tipos, eventos, reglas del flujo, sin infraestructura), `daemon`, `cli` y, más adelante, `web`. https://claude.ai/artifact/XzzEpqEVDdqRpTFWYxBTKT
- **ADR-003, runtime del agente:** Claude Agent SDK de TypeScript (versión fijada) detrás de la interfaz `AgentRuntime`; Codex como segundo runtime y candidato a revisor delegado. Herramientas por estado con `allowedTools` + `dontAsk`, `settingSources` vacío y hooks de forja que bloquean tests existentes, configuración de gates, `.github/`, credenciales y ficheros fuera del plan. Uso personal con la suscripción; modo equipo con API key. https://claude.ai/artifact/TGxQ7QvH9aaKeQbbdv9yxU
- **ADR-004, modelo de datos:** event sourcing con un stream por tarea, decider puro en `core`, SQLite con cadena de hashes y triggers append-only, trayectoria del agente en una tabla aparte, blobs cifrados por tarea y clase de dato (crypto-shredding) y actores seudónimos. Retenciones propuestas pendientes de fijar antes del modo equipo. docs/adr/004-modelo-de-datos.md
- **ADR-005, API y CLI de la rebanada 1:** API HTTP en un socket Unix con token obligatorio; un endpoint por comando del decider; actor sacado del token; `If-Match`, `Idempotency-Key` y errores RFC 9457; SSE con `Last-Event-ID`. Hono, zod y better-sqlite3 13.x. El sandbox del agente es requisito antes de la rebanada 2. docs/adr/005-api-y-cli-rebanada-1.md

### Requisitos para el modelo de datos (paso 4)
- Los cuatro requisitos del modo equipo (backlog): actor en cada evento, CLI solo contra la API, almacenamiento y workspace detrás de interfaces.
- Entidad **especialista** versionada; cada sesión registra runtime, versión, modelo y especialista (con versión) usados.
- Toda decisión humana o delegada de "pedir cambios", "rechazar" o fallo de tarea guarda un motivo con categoría (malentendido, alcance, lógica, tests, estilo, otro) y texto libre: es la materia prima del aprendizaje.

Construcción por rebanadas usables de punta a punta: (1) tareas + log de eventos, (2) planificación, (3) construcción + verificación, (4) PR + merge.

### Backlog (no perder)
- **Modo equipo (varias personas).** No se construye ahora, pero se diseña para no cerrarle la puerta. Requisitos obligatorios desde el paso 4:
  1. Todo evento lleva un actor, aunque al principio siempre sea el mismo.
  2. La CLI habla solo con la API del daemon; nunca con la base de datos ni con git directamente.
  3. Almacenamiento detrás de una interfaz (SQLite ahora, Postgres en equipo).
  4. Workspace detrás de una interfaz (worktree ahora; contenedores o sandboxes cloud en equipo).
  Cuando llegue: daemon en servidor, identidad propia en GitHub (GitHub App), permisos de aprobación por nivel de riesgo y por persona, costes por persona o proyecto vía gateway LLM.
- **Agentes especialistas.** Un especialista es una configuración versionada de un rol (planner, builder o reviewer): instrucciones, herramientas, modelo, contexto y gates extra. Las definiciones viven en forja, nunca en el repo objetivo (principio 4). Selección determinista: rol del estado + reglas de encaje (rutas, riesgo, etiquetas, origen); gana el más específico y, si no encaja ninguno, el genérico. La elección se muestra en `plan_review` y se puede cambiar. Cada especialista se evalúa contra el genérico con datos. Se construye después del piloto.
- **Aprendizaje del sistema.** Los modelos no aprenden; mejora la configuración. Bucle: los motivos de rechazo, fallos de gates, tareas fallidas y reverts se agrupan; un agente propone cambios a instrucciones o especialistas; esa propuesta es una tarea de forja con su `plan_review` humano; la nueva versión se compara con la anterior con métricas. Sin memoria automática escrita por los agentes en las sesiones de forja. Se construye después del piloto; la captura de motivos empieza en el paso 4.
- Adaptadores de intake adicionales: Jira, Sentry, conversación con el agente.
- Web UI con la pantalla de revisión (diff + evidencia de gates).
- Varios agentes en paralelo.
- Capas de verificación 3–6 (PBT, mutation testing, verificación formal, holdout + monitor de trayectoria).
- Ajustes del script de línea base: excluir el scope `factory`, lead time desde el primer commit, retrabajo a nivel de commit, métrica de revisión.
- Confirmar si la merge queue nativa de GitHub está disponible para `promos`.
