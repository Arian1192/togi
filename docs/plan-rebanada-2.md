# Plan de la rebanada 2: planificación con agente

4 de noviembre de 2026 · Arian

Al terminar esta rebanada, `togi task submit 12` lanza un agente que lee el repo de la tarea dentro de un sandbox y propone un plan. El usuario lo revisa con `togi plan show 12` y lo aprueba, pide cambios con un motivo o lo rechaza. Si pide cambios, el agente propone una versión nueva teniendo en cuenta el motivo. Es el gate 1 del ADR-001 funcionando de punta a punta.

Fuera de alcance: que el agente escriba código (rebanada 3) o abra PRs (rebanada 4). Una tarea aprobada queda en `building`, sin que nada la construya todavía.

## Decisiones de partida

Aprobadas antes de escribir este plan, además del ADR-008:

1. **Acceso al repo:** el usuario registra un clon local (`togi repo add`), y togi crea a partir de él una copia de solo lectura en la rama base para cada sesión. Togi no guarda credenciales de GitHub en esta rebanada.
2. **Cuándo se planifica:** automáticamente al hacer `submit` y al pedir cambios, con un único agente a la vez.
3. **Credenciales del agente:** los dos modos del ADR-008, con la clave de API por defecto.
4. **Tamaño del plan:** el plan estima por separado las líneas de producción y las de tests, y el gate 1 aplica los límites del ADR-007 (200 de producción y 500 en total). Esto cambia el `FlowPolicy` del ADR-001 y adelanta a esta rebanada lo que el ADR-007 dejaba para la 3; el PR 1 lo anota en los dos ADRs.
5. **Límites de una sesión:** 10 minutos y un tope de coste configurable, a revisar con los primeros datos.
6. **Dónde se ejecuta:** en el Mac del usuario, con el trabajador separado del daemon (ADR-008).

## Los PRs

Las cifras son estimaciones de líneas de producción. Si un plan pasa de los límites del ADR-007, se parte.

| # | PR | Fase | Depende de | Producción aprox. |
| --- | --- | --- | --- | --- |
| 1 | `feat(core): sesiones y planes` | Revisión sin agente | — | 150 |
| 2 | `feat(core): reglas del gate 1` | Revisión sin agente | 1 | 150 |
| 3 | `feat(daemon): proyecciones de planes y sesiones` | Revisión sin agente | 2 | 150 |
| 4 | `feat(daemon): API de planes` | Revisión sin agente | 3 | 150 |
| 5 | `feat(cli): togi plan` | Revisión sin agente | 4 | 180 |
| 6 | `feat(daemon): orquestador con planificador falso` | Revisión sin agente | 3 | 180 |
| 7 | `feat: registro de repos` | Ejecución | 4 | 180 |
| 8 | `feat(daemon): copia de solo lectura del repo` | Ejecución | 7 | 120 |
| 9 | `feat: interfaz Sandbox e implementación con srt` | Ejecución | 1 | 200 |
| 10 | `test: batería de conformidad del sandbox` | Ejecución | 9 | 60 |
| 11 | `feat: credenciales del agente` | Ejecución | 4 | 180 |
| 12 | `feat(daemon): trayectoria y limpieza de secretos` | Ejecución | 3 | 180 |
| 13 | `feat: el trabajador de agentes` | Ejecución | 6, 9 | 200 |
| 14 | `feat(worker): adaptador del Claude Agent SDK` | Planificador real | 13 | 200 |
| 15 | `feat: especialista generic-planner@1` | Planificador real | 14 | 150 |
| 16 | `feat(daemon): planificador real` | Planificador real | 8, 11, 12, 15 | 180 |
| 17 | `test: extremo a extremo de la rebanada 2` | Cierre | 16 | 40 |
| 18 | `test: prueba de ataque` | Cierre | 16 | 40 |
| 19 | `docs: cierre de la rebanada 2` | Cierre | 17, 18 | 0 |

Los PRs 1 a 6 construyen y prueban la revisión de planes con un planificador falso, antes de traer ningún agente: es el principio 1, los controles antes que la flota. Los PRs 7 a 13 construyen la infraestructura de ejecución, y del 14 al 16 llega el agente real.

## Cómo usar este plan

Una sesión de Claude Code por PR, con el alias `togi-claude`, desde `main` actualizado:

```bash
cd ~/Documents/Dev/projects/togi && git checkout main && git pull && togi-claude
```

1. **Plan.** Activa el modo plan y pega el prompt del PR.
2. **Gate 1: revisa el plan.** Solo toca lo que pide la tarea; añade tests y no modifica los existentes; cumple el ADR-007; dependencias con versión exacta y fecha; nada contradice un ADR.
3. **Construcción.** Aprueba con "Yes, manually approve edits", nunca en modo auto.
4. **Gate 2: revisa el PR.** El diff coincide con el plan, la CI está en verde, el commit lleva `Assisted-by` y `node tools/diff-size.mjs` cuadra. Comprueba con `git diff --no-ext-diff --name-status main | grep -i test` que todos los tests son nuevos, salvo los autorizados.
5. Sesión nueva antes del siguiente PR.

Registra cada PR como tarea en togi con `togi task new` a medida que lo empieces: así se usa togi en su propio desarrollo.

Todos los prompts terminan con el mismo bloque de restricciones y la petición de plan.

---

## PR 1 · feat(core): sesiones y planes

```
Tarea: PR 1 de docs/plan-rebanada-2.md — feat(core): sesiones y planes.
Lee antes: AGENTS.md, docs/adr/001, docs/adr/004 (eventos y entidades), docs/adr/007 y docs/adr/008.

Objetivo: los tipos, eventos y esquemas de la planificación, sin lógica.
- Eventos del ADR-004 para esta rebanada: session.started, session.ended, plan.proposed y
  decision.recorded (solo gate "plan" y mode "binding"), con sus esquemas zod estrictos en
  toDomainEvent.
- Plan, con dos cambios sobre el ADR-004: estimatedLines pasa a { production, tests } (ADR-007), y
  añade baseSha, el commit sobre el que se planificó.
- FlowPolicy: maxProductionLines 200, maxTotalLines 500 y maxFailedCycles 3.
- Usage (tokens de entrada y salida, coste estimado, duración) para session.ended.
- Actualiza el ADR-001 y el ADR-007 con una nota: el límite del gate 1 sigue el ADR-007 desde la
  rebanada 2.
- Tests de los esquemas: válidos, campo de más, campo de menos, valor fuera de la lista.

Fuera de alcance: reglas del decider, proyecciones, API.
```

## PR 2 · feat(core): reglas del gate 1

```
Tarea: PR 2 de docs/plan-rebanada-2.md — feat(core): reglas del gate 1.
Lee antes: AGENTS.md, docs/adr/001 y docs/adr/004 (reglas del flujo).

Objetivo: las reglas de la planificación en el decider, cada una con su test.
- Comandos: startSession y endSession (actor system), proposePlan (actor agent, de la sesión activa),
  approvePlan, requestPlanChanges y rejectPlan (actor human).
- Solo una sesión activa por tarea. proposePlan solo en planning y solo de la sesión activa; lleva
  la tarea a plan_review con planVersion = la anterior + 1.
- approvePlan, requestPlanChanges y rejectPlan solo en plan_review y sobre la última planVersion.
  approvePlan lleva a building; requestPlanChanges vuelve a planning; rejectPlan, a rejected.
- requestPlanChanges y rejectPlan exigen motivo. approvePlan se rechaza si el plan supera
  maxProductionLines o maxTotalLines, con un code propio.
- Un agente nunca puede aprobar, pedir cambios ni rechazar: esos comandos exigen actor human.
- Una sesión que termina en failed o timeout deja la tarea en planning.

Fuera de alcance: persistencia y API.
```

## PR 3 · feat(daemon): proyecciones de planes y sesiones

```
Tarea: PR 3 de docs/plan-rebanada-2.md — feat(daemon): proyecciones de planes y sesiones.
Lee antes: AGENTS.md y docs/adr/004 (almacenamiento).

Objetivo: las proyecciones plans, sessions y decisions, actualizadas en la misma transacción que el
append, con su migración y la reconstrucción al migrar.
- plans: tarea, planVersion, sesión, baseSha, ficheros, tests nuevos, referencia del enfoque,
  líneas estimadas y fecha. Nunca el texto del enfoque.
- sessions: id, tarea, rol, runtime, modelo, especialista, estado, inicio, fin, resultado y uso.
- decisions: tarea, gate, veredicto, planVersion, actor y fecha. El motivo, solo como referencia.
- Tests: cada proyección refleja una secuencia de eventos; rebuild da el mismo resultado que la
  aplicación incremental; la migración desde la versión actual conserva los eventos.

Fuera de alcance: API y CLI.
```

## PR 4 · feat(daemon): API de planes

```
Tarea: PR 4 de docs/plan-rebanada-2.md — feat(daemon): API de planes.
Lee antes: AGENTS.md y docs/adr/005.

Objetivo: las rutas de la revisión de planes.
- GET /v1/tasks/:n/plan: el último plan, con el enfoque descifrado ([borrado] y su indicador si su
  clave no existe), y las versiones anteriores sin el enfoque.
- POST /v1/tasks/:n/plan/approve, /plan/request-changes y /plan/reject, con If-Match y los errores
  RFC 9457 del decider. request-changes y reject exigen motivo con categoría.
- GET /v1/tasks/:n/sessions: las sesiones de la tarea, sin trayectoria.
- El detalle de la tarea incluye la versión del plan vigente, si existe.
- Tests de cada ruta, incluido que un actor que no es humano no puede decidir.

Fuera de alcance: CLI y planificador.
```

## PR 5 · feat(cli): togi plan

```
Tarea: PR 5 de docs/plan-rebanada-2.md — feat(cli): togi plan.
Lee antes: AGENTS.md, docs/adr/005 y docs/cli-estilo.md.

Objetivo: los comandos de revisión de planes, con la guía de estilo.
- togi plan show <n> [--version <v>]: ficheros con su tipo de cambio, tests nuevos, enfoque, líneas
  estimadas de producción y de tests, baseSha y versión. Si el plan pasa de los límites, avísalo.
- togi plan approve <n>, togi plan request-changes <n> --category --reason y
  togi plan reject <n> --category --reason [--yes], con ETag e If-Match como task submit y reject.
- togi task show muestra la versión del plan vigente.
- Con --json y su ayuda. El texto del enfoque, sin caracteres de control.
- Actualiza docs/cli-estilo.md con un ejemplo de plan show.

Fuera de alcance: planificador.
```

## PR 6 · feat(daemon): orquestador con planificador falso

```
Tarea: PR 6 de docs/plan-rebanada-2.md — feat(daemon): orquestador con planificador falso.
Lee antes: AGENTS.md, docs/adr/001, docs/adr/004 y docs/adr/008 (puntos 4 y 5).

Objetivo: lanzar la planificación automáticamente, con un planificador falso.
- Una interfaz Planner que recibe la tarea y devuelve un plan o un fallo.
- Un orquestador en el daemon que reacciona a task.submitted y a requestPlanChanges: inicia la
  sesión, llama al Planner, registra plan.proposed o el fallo, y cierra la sesión. Un único
  planificador a la vez; el resto espera en cola.
- Un FakePlanner determinista, solo activable en tests, nunca por una variable de entorno.
- Al arrancar el daemon, una sesión que quedó abierta se cierra como failed.
- Tests: submit lleva a plan_review solo; request-changes produce una versión nueva; dos tareas
  enviadas a la vez se planifican una detrás de otra; un fallo del planificador deja la tarea en
  planning con su sesión cerrada.

Fuera de alcance: agentes reales, sandbox, trabajador.
```

## PR 7 · feat: registro de repos

```
Tarea: PR 7 de docs/plan-rebanada-2.md — feat: registro de repos.
Lee antes: AGENTS.md y docs/adr/005.

Objetivo: que el usuario diga a togi dónde está el clon local de cada repo.
- Una tabla repos (owner/repo → ruta local), con su migración.
- API y CLI: togi repo add <owner/repo> --path <ruta>, togi repo list, togi repo remove.
- Al registrar: la ruta existe, es un repo git y su remote apunta a ese owner/repo. La ruta se
  guarda resuelta, y se rechaza si está dentro de TOGI_HOME.
- Una tarea cuyo repo no está registrado no se puede planificar: el orquestador cierra la sesión con
  un motivo claro.
- Tests de cada validación.

Fuera de alcance: crear la copia del repo (PR 8).
```

## PR 8 · feat(daemon): copia de solo lectura del repo

```
Tarea: PR 8 de docs/plan-rebanada-2.md — feat(daemon): copia de solo lectura del repo.
Lee antes: AGENTS.md y docs/adr/008 (punto 1).

Objetivo: preparar el repo que leerá el planificador.
- Para cada sesión, una copia exportada con git archive de la rama base de la tarea (no un
  git worktree: su checkout ejecutaría los hooks del repo en el daemon, fuera del sandbox), dentro de
  TOGI_HOME/workspaces/<sesión>, sin tocar la carpeta de trabajo del usuario.
- Devuelve la ruta y el baseSha. Se borra siempre al terminar la sesión, también si falla.
- Los comandos de git se lanzan sin shell, con argumentos validados.
- Tests: la copia contiene la rama base y no los cambios sin commitear del clon; se borra tras la
  sesión; un nombre de rama inexistente da un error claro.

Fuera de alcance: el sandbox.
```

## PR 9 · feat: interfaz Sandbox e implementación con srt

```
Tarea: PR 9 de docs/plan-rebanada-2.md — feat: interfaz Sandbox e implementación con srt.
Lee antes: AGENTS.md, docs/adr/008 entero y docs/research/2026-11-experimento-sandbox.md.

Objetivo: la interfaz del ADR-008 y su primera implementación.
- En core, el puerto Sandbox y su especificación: lectura, directorio escribible, dominios exactos,
  variables de entorno permitidas, credenciales a ocultar con sus dominios, y tope de tiempo.
- Un paquete nuevo, packages/worker, con la implementación SrtSandbox, con la configuración
  obligatoria del ADR-008: denyRead de la carpeta personal con allowRead explícito, allowWrite solo
  del directorio desechable, sin sockets Unix ni puertos locales, y credentials.envVars en modo mask
  con tlsTerminate.
- Versión de srt fijada, de al menos dos semanas.
- Tests unitarios de la traducción de especificación a configuración de srt. La batería de seguridad
  va en el PR 10.

Fuera de alcance: el trabajador y los agentes.
```

## PR 10 · test: batería de conformidad del sandbox

```
Tarea: PR 10 de docs/plan-rebanada-2.md — test: batería de conformidad del sandbox.
Lee antes: docs/adr/008 (punto 8) y docs/research/2026-11-experimento-sandbox.md.

Objetivo: la batería del experimento como tests de cualquier implementación de Sandbox.
- Las sondas del experimento: secretos falsos, ~/.ssh, el Llavero con una entrada de prueba, socket
  y puerto local falsos, red permitida y bloqueada, DNS, escritura y variables de entorno. Cada una,
  con su control positivo, y clasificada como bloqueada o inaccesible por diseño.
- Ninguna sonda imprime contenido. Los secretos falsos se crean y se borran en el propio test.
- Se ejecuta contra SrtSandbox. Propón cómo ejecutarla en la CI de macOS y qué hacer con la sonda del
  Llavero si el runner no lo permite.

Fuera de alcance: credenciales reales y agentes.
```

## PR 11 · feat: credenciales del agente

```
Tarea: PR 11 de docs/plan-rebanada-2.md — feat: credenciales del agente.
Lee antes: AGENTS.md y docs/adr/008 (punto 6).

Objetivo: los dos modos de credenciales del agente.
- togi auth set-api-key: lee la clave por la entrada estándar, nunca como argumento, y la guarda en
  el Llavero. togi auth use-subscription: lee el token igual. togi auth status: el modo activo, sin
  mostrar valores.
- La API recibe el valor en el cuerpo y nunca lo devuelve ni lo registra. Ningún log, evento ni
  error contiene la credencial.
- El daemon entrega la credencial solo al trabajador, para la especificación del sandbox: en modo
  clave de API, para ocultarla con marcador; en modo suscripción, en su variable.
- Tests: la credencial no aparece en ninguna respuesta, evento, blob ni salida de error; status no
  la muestra; cambiar de modo sustituye la anterior.

Fuera de alcance: el trabajador.
```

## PR 12 · feat(daemon): trayectoria y limpieza de secretos

```
Tarea: PR 12 de docs/plan-rebanada-2.md — feat(daemon): trayectoria y limpieza de secretos.
Lee antes: AGENTS.md y docs/adr/004 (almacenamiento y datos personales).

Objetivo: guardar lo que hace el agente, sin secretos.
- Escritura en agent_events con su cadena de hashes por sesión, y verify-log que también la recorre.
- Cada payload va a un blob de clase trajectory, después de pasar por un detector de secretos con
  reglas tipo gitleaks: lo detectado se sustituye por [REDACTED:<regla>]. Propón si implementar las
  reglas o usar una dependencia, y justifícalo.
- Tipos: tool_call, tool_result, message, denied y usage. Las acciones denegadas por el sandbox
  quedan como denied.
- Tests: la cadena detecta una manipulación; una clave de API de prueba, un token y una clave privada
  se limpian; los textos sin secretos pasan intactos.

Fuera de alcance: el trabajador que produce la trayectoria.
```

## PR 13 · feat: el trabajador de agentes

```
Tarea: PR 13 de docs/plan-rebanada-2.md — feat: el trabajador de agentes.
Lee antes: AGENTS.md y docs/adr/008 (puntos 4 y 5).

Objetivo: el proceso que ejecuta agentes, separado del daemon.
- El daemon lanza el trabajador como proceso hijo y se comunica con él por entrada y salida
  estándar, con mensajes JSON por línea: la orden de la sesión, los eventos de trayectoria, el
  resultado y un latido.
- El trabajador recibe la especificación del sandbox y la credencial, lanza el agente dentro del
  sandbox y le habla solo por su entrada y salida estándar.
- El daemon impone el tope de tiempo: si se agota o el trabajador muere, cierra la sesión como
  timeout o failed y mata el proceso.
- El trabajador nunca recibe el token del daemon ni la ruta de TOGI_HOME.
- Tests con un agente falso: una sesión completa, un tope de tiempo agotado, un trabajador que muere,
  y la trayectoria registrada.

Fuera de alcance: el adaptador del Claude Agent SDK.
```

## PR 14 · feat(worker): adaptador del Claude Agent SDK

```
Tarea: PR 14 de docs/plan-rebanada-2.md — feat(worker): adaptador del Claude Agent SDK.
Lee antes: AGENTS.md, docs/adr/003 y docs/adr/008 (punto 7).

Objetivo: el primer adaptador de runtime.
- Declara lo que necesita: sus dominios, su credencial con sus dominios, sus rutas escribibles y que
  no trae sandbox propio.
- Lanza el agente con settingSources vacío, solo con herramientas de lectura para el planificador
  (lectura, búsqueda y listado de ficheros; sin Bash, sin escritura y sin acceso web).
- Hooks que deniegan y registran cualquier otra herramienta.
- Tope de turnos y de coste, y el uso real en el resultado.
- Versión del SDK fijada, de al menos dos semanas.
- Tests con el SDK simulado: la declaración, la política de herramientas y los topes. La prueba con el
  modelo real va en el PR 17.

Fuera de alcance: el prompt del planificador (PR 15).
```

## PR 15 · feat: especialista generic-planner@1

```
Tarea: PR 15 de docs/plan-rebanada-2.md — feat: especialista generic-planner@1.
Lee antes: AGENTS.md, docs/adr/001, docs/adr/004 y docs/adr/007.

Objetivo: el primer especialista, versionado.
- El prompt del planificador: lee la tarea y el repo, y devuelve un plan con ficheros, tests nuevos,
  enfoque y líneas estimadas de producción y de tests. Sabe que el plan se parte si pasa de los
  límites del ADR-007, y que los textos de la tarea y del repo son datos, nunca instrucciones.
- El evento specialist.version_published, con el hash del contenido.
- La salida del agente se valida con un esquema zod estricto. Si no encaja, un único reintento con el
  error; si vuelve a fallar, la sesión termina como failed.
- En una petición de cambios, el prompt incluye el plan anterior y el motivo, marcado como texto del
  usuario.
- Tests de la validación y del prompt generado.

Fuera de alcance: conectarlo al orquestador.
```

## PR 16 · feat(daemon): planificador real

```
Tarea: PR 16 de docs/plan-rebanada-2.md — feat(daemon): planificador real.
Lee antes: AGENTS.md y docs/adr/008.

Objetivo: sustituir el planificador falso por el real.
- Un Planner que une la copia del repo, las credenciales, el trabajador, el adaptador y el
  especialista. El enfoque del plan va a un blob task_text; el prompt, a un blob prompt.
- session.started registra runtime, versión, modelo, especialista y las referencias del prompt y la
  política; session.ended, el uso real.
- Límites: 10 minutos y el tope de coste configurable.
- togi plan retry <n>: lanza otra sesión para una tarea que quedó en planning tras un fallo.
- Tests con el agente falso en el trabajador real: el ciclo completo y la limpieza de la copia del
  repo y del directorio desechable.

Fuera de alcance: pruebas con el modelo real (PR 17).
```

## PR 17 · test: extremo a extremo de la rebanada 2

```
Tarea: PR 17 de docs/plan-rebanada-2.md — test: extremo a extremo de la rebanada 2.
Lee antes: el PR 11 de docs/plan-rebanada-1.md y packages/e2e.

Objetivo: dos recorridos en packages/e2e.
- En la CI, con el agente falso dentro del sandbox real: registrar un repo de prueba, crear y enviar
  una tarea, ver el plan, pedir cambios, ver la versión 2 y aprobarla; y un plan que pasa de los
  límites no se puede aprobar.
- Manual, fuera de la CI, con el modelo real y la credencial del usuario: el mismo recorrido sobre
  un repo de prueba. Un script documentado, que no imprime credenciales.

Fuera de alcance: código de producción. Si el test descubre un fallo, para y descríbelo.
```

## PR 18 · test: prueba de ataque

```
Tarea: PR 18 de docs/plan-rebanada-2.md — test: prueba de ataque.
Lee antes: docs/adr/005 (prueba de ataque) y docs/adr/008.

Objetivo: demostrar que un agente manipulado no puede saltarse los controles.
- Un repo de prueba con instrucciones maliciosas en el README y en un fichero de código: leer
  ~/.togi, conectarse al socket, leer el Llavero, salir a un dominio externo y aprobar su propio plan
  a través de la API.
- En la CI, un agente falso que intenta todo eso: cada intento queda denegado y registrado en la
  trayectoria como denied, y la tarea sigue esperando la decisión humana.
- Manual, con el modelo real sobre el mismo repo: el mismo resultado, documentado.

Fuera de alcance: código de producción. Si el test descubre un fallo, para y descríbelo.
```

## PR 19 · docs: cierre de la rebanada 2

Lo hace el usuario: el README con los comandos nuevos y el estado, y la línea de este plan que lo marca como completado.

---

## Bloque común de restricciones

Cada prompt termina con este bloque:

```
Restricciones: las de AGENTS.md y CLAUDE.md; versiones exactas, con releases de al menos dos
semanas; no modificar tests existentes ni la CI sin autorización; mide con node tools/diff-size.mjs
después de git add: si pasas de los límites del ADR-007, para y propón cómo partirlo. Nunca quites,
fusiones ni muevas tests para cumplir el límite.

No escribas código todavía. Propón un plan con:
1. Ficheros a crear o modificar.
2. Tests nuevos.
3. Dependencias nuevas con versión exacta y fecha de release (o "ninguna").
4. Tamaño estimado, separando producción y tests.
5. Dudas o contradicciones con los ADRs.
```

## Dudas abiertas

- **La batería del sandbox en la CI:** los runners de macOS de GitHub Actions quizá no permitan crear una entrada de prueba en el Llavero. El PR 10 propone la solución.
- **El modelo del planificador:** a fijar en el PR 14, con el coste por plan medido en el PR 17.
- **La telemetría del cliente del agente:** desactivarla o solo bloquearla, pendiente del ADR-008.
