# Plan de la rebanada 1: tareas y log de eventos

2 de noviembre de 2026 · Arian

Once PRs, cada uno con un solo objetivo y menos de 300 líneas, en orden de dependencias. Al terminar el PR 11 se cumple el criterio de hecho del ADR-005. Las cifras de líneas son estimaciones; si un plan las supera, se parte (ADR-001, regla 3).

| # | PR | Depende de | Líneas aprox. |
| --- | --- | --- | --- |
| 1 | `chore: monorepo` | — | 150 |
| 2 | `feat(core): modelo y puertos` | 1 | 220 |
| 3 | `feat(core): decider` | 2 | 250 |
| 4 | `feat(core): cadena de hashes` | 2 | 150 |
| 5 | `feat(daemon): event store` | 2, 4 | 280 |
| 6 | `feat(daemon): claves y blobs` | 5 | 280 |
| 7 | `feat(daemon): comandos y proyección` | 3, 5, 6 | 250 |
| 8 | `feat(daemon): API` | 7 | 280 |
| 9 | `feat(daemon): eventos, idempotencia y admin` | 8 | 200 |
| 10 | `feat(cli): comandos` | 9 | 280 |
| 11 | `test: extremo a extremo de la rebanada 1` | 10 | 200 |

## Cómo usar este plan

Una sesión de Claude Code por PR, partiendo de `main` actualizado:

```bash
cd ~/Documents/Dev/projects/forja && git checkout main && git pull && claude
```

1. **Plan.** Activa el modo plan (Shift+Tab hasta ver *plan mode on*, o empieza el mensaje con `/plan`) y pega el prompt del PR.
2. **Gate 1: revisa el plan.** Solo toca lo que pide la tarea; añade tests y no modifica los existentes; menos de 300 líneas; dependencias con versión exacta y fecha; nada contradice un ADR. Si algo no cuadra, pide otro plan.
3. **Construcción.** Aprueba en el modo que pide confirmación antes de cada cambio. Al terminar, pídele: *"Ejecuta typecheck, lint y test. Si todo pasa, crea la rama, haz un solo commit en conventional commits con el trailer Assisted-by y el identificador real del modelo, y abre un PR hacia main con gh, con el plan aprobado en la descripción."*
4. **Gate 2: revisa el PR.** El diff coincide con el plan, la CI está en verde y el commit lleva `Assisted-by`. Mergea. Apunta cualquier desviación del plan: es materia prima para el gate `plan_contract`.
5. `/clear` o sesión nueva antes del siguiente PR.

Todos los prompts terminan con el mismo bloque de restricciones y la petición de plan, para que cada uno se pueda copiar entero.

---

## PR 1 · chore: monorepo

```
Tarea: PR 1 de docs/plan-rebanada-1.md — chore: monorepo.
Lee antes: AGENTS.md, docs/adr/002 y docs/adr/005.

Objetivo: dejar el monorepo listo para que los PRs siguientes solo añadan código.
- Workspace pnpm con packages/core, packages/daemon y packages/cli, vacíos salvo un index.ts.
- tsconfig base estricto, heredado por los tres paquetes.
- Tests con node:test. Propón cómo ejecutarlos sobre TypeScript con el mínimo de dependencias.
- Lint y formato con Biome.
- CI en GitHub Actions: typecheck, lint y test en cada PR hacia main.
- engines (Node >= 22) y packageManager fijados en el package.json raíz.

Fuera de alcance: cualquier lógica de forja.

Restricciones: las de AGENTS.md; si durante la construcción algo no encaja con el plan aprobado,
para y pregunta en lugar de decidir; sin ficheros de seguimiento ni memoria propios (odd/, Engram); versiones exactas, con releases de al menos dos semanas;
core no depende de daemon ni de cli; menos de 300 líneas sin contar el lockfile.

No escribas código todavía. Propón un plan con:
1. Ficheros a crear o modificar.
2. Tests nuevos.
3. Dependencias nuevas con versión exacta y fecha de release (o "ninguna").
4. Tamaño estimado en líneas.
5. Dudas o contradicciones con los ADRs.
```

## PR 2 · feat(core): modelo y puertos

```
Tarea: PR 2 de docs/plan-rebanada-1.md — feat(core): modelo y puertos.
Lee antes: AGENTS.md, docs/adr/004 (secciones de decisión, eventos y almacenamiento) y docs/adr/005.

Objetivo: los tipos y esquemas que usa la rebanada 1, sin lógica.
- packages/core/src/model: ids (TaskId, UserId, SessionId…), Actor, EventEnvelope, BlobRef,
  DataClass, RiskLevel, TaskState, ReasonCategory, Reason, TaskSource.
- Eventos de la rebanada 1: task.created, task.edited, task.submitted, task.rejected.
  Precisión sobre el ADR-004: description y acceptanceCriteria son BlobRef | null (null si el texto
  está vacío), para que el decider sepa si hay criterio de aceptación sin leer el blob.
- packages/core/src/ports: las interfaces EventStore y BlobStore del ADR-004.
- packages/core/src/api/schemas.ts: los esquemas zod del ADR-005 (CreateTask, EditTask, RejectTask).
- Tests de los esquemas: casos válidos e inválidos.

Fuera de alcance: eventos de rebanadas posteriores, decider, implementaciones de los puertos.

Restricciones: las de AGENTS.md; si durante la construcción algo no encaja con el plan aprobado,
para y pregunta en lugar de decidir; sin ficheros de seguimiento ni memoria propios (odd/, Engram); versiones exactas, con releases de al menos dos semanas;
core sin dependencias de infraestructura; no modificar tests existentes ni la CI;
menos de 300 líneas sin contar el lockfile.

No escribas código todavía. Propón un plan con:
1. Ficheros a crear o modificar.
2. Tests nuevos.
3. Dependencias nuevas con versión exacta y fecha de release (o "ninguna").
4. Tamaño estimado en líneas.
5. Dudas o contradicciones con los ADRs.
```

## PR 3 · feat(core): decider

```
Tarea: PR 3 de docs/plan-rebanada-1.md — feat(core): decider.
Lee antes: AGENTS.md, docs/adr/001 y docs/adr/004 (sección de reglas del flujo).

Objetivo: las reglas de la rebanada 1 como funciones puras en packages/core/src/flow.
- TaskView, TaskCommand (create, edit, submit, reject), DomainError con un code estable, FlowPolicy.
- evolve(view, event) y decide(view, cmd, policy).
- Reglas, cada una con su test:
  - create solo sobre una tarea inexistente y produce draft.
  - edit solo en draft.
  - submit solo desde draft y exige criterio de aceptación (no null) y nivel de riesgo.
  - reject exige motivo con categoría y es válido desde cualquier estado no final.
  - merged, failed y rejected no aceptan ningún comando.
  - Un comando inválido devuelve DomainError y ningún evento.

Fuera de alcance: persistencia, blobs, API.

Restricciones: las de AGENTS.md; si durante la construcción algo no encaja con el plan aprobado,
para y pregunta en lugar de decidir; sin ficheros de seguimiento ni memoria propios (odd/, Engram); versiones exactas, con releases de al menos dos semanas;
core sin dependencias de infraestructura; no modificar tests existentes ni la CI;
menos de 300 líneas sin contar el lockfile.

No escribas código todavía. Propón un plan con:
1. Ficheros a crear o modificar.
2. Tests nuevos.
3. Dependencias nuevas con versión exacta y fecha de release (o "ninguna").
4. Tamaño estimado en líneas.
5. Dudas o contradicciones con los ADRs.
```

## PR 4 · feat(core): cadena de hashes

```
Tarea: PR 4 de docs/plan-rebanada-1.md — feat(core): cadena de hashes.
Lee antes: AGENTS.md y docs/adr/004 (sección de almacenamiento).

Objetivo: el cálculo de integridad del log, puro, en packages/core/src/integrity.
- canonicalize(value): JSON canónico según RFC 8785. Propón si implementarlo o usar una
  dependencia, y justifícalo.
- hashEvent(prevHash, envelope): sha256 de prevHash concatenado con el JSON canónico del envelope
  (seq, stream, streamVersion, type, schemaVersion, actor, at, correlationId, payload).
  Génesis: 64 ceros.
- verifyChain(events): devuelve ok o el primer seq roto.
- Tests con casos del propio RFC 8785 y con una cadena alterada.

Fuera de alcance: SQLite y cualquier escritura en disco.

Restricciones: las de AGENTS.md; si durante la construcción algo no encaja con el plan aprobado,
para y pregunta en lugar de decidir; sin ficheros de seguimiento ni memoria propios (odd/, Engram); versiones exactas, con releases de al menos dos semanas;
core sin dependencias de infraestructura (node:crypto está permitido); no modificar tests
existentes ni la CI; menos de 300 líneas sin contar el lockfile.

No escribas código todavía. Propón un plan con:
1. Ficheros a crear o modificar.
2. Tests nuevos.
3. Dependencias nuevas con versión exacta y fecha de release (o "ninguna").
4. Tamaño estimado en líneas.
5. Dudas o contradicciones con los ADRs.
```

## PR 5 · feat(daemon): event store

```
Tarea: PR 5 de docs/plan-rebanada-1.md — feat(daemon): event store.
Lee antes: AGENTS.md, docs/adr/004 (sección de almacenamiento) y docs/adr/005 (dependencias).

Objetivo: la implementación SQLite del puerto EventStore en packages/daemon/src/store.
- Configuración de rutas: la raíz es FORJA_HOME, por defecto ~/.forja. Los tests usan siempre un
  directorio temporal.
- Esquema del ADR-004: tablas events y agent_events (esta, vacía de momento), triggers append-only
  y versión de esquema con PRAGMA user_version.
- append con expectedVersion en una transacción inmediata: calcula seq, prev_hash y hash con
  packages/core/src/integrity. Devuelve conflicto si la versión no coincide.
- Una forma de ejecutar código del llamante dentro de la misma transacción del append, para las
  proyecciones del PR 7. Propón la firma.
- readStream, readAll y verify. Al leer, correlation_id NULL se convierte en campo ausente:
  hashEvent rechaza null (PR 4), así que sin esa conversión verify falla en esos eventos.
- Tests: append y lectura, conflicto de versión, UPDATE y DELETE rechazados por los triggers,
  verify en verde con eventos con y sin correlationId, y manipulación detectada (el test quita los triggers, cambia una fila y
  verify devuelve el seq roto).

Fuera de alcance: blobs, cifrado, proyecciones, API.

Restricciones: las de AGENTS.md; si durante la construcción algo no encaja con el plan aprobado,
para y pregunta en lugar de decidir; sin ficheros de seguimiento ni memoria propios (odd/, Engram); versiones exactas, con releases de al menos dos semanas
(better-sqlite3 13.x según el ADR-005); no modificar tests existentes ni la CI;
menos de 300 líneas sin contar el lockfile.

No escribas código todavía. Propón un plan con:
1. Ficheros a crear o modificar.
2. Tests nuevos.
3. Dependencias nuevas con versión exacta y fecha de release (o "ninguna").
4. Tamaño estimado en líneas.
5. Dudas o contradicciones con los ADRs.
```

## PR 6 · feat(daemon): claves y blobs

```
Tarea: PR 6 de docs/plan-rebanada-1.md — feat(daemon): claves y blobs.
Lee antes: AGENTS.md y docs/adr/004 (secciones de almacenamiento y datos personales).

Objetivo: la implementación del puerto BlobStore con cifrado y crypto-shredding.
- Una interfaz Keychain con dos implementaciones: macOS, con el comando security vía execFile
  (nunca a través de un shell), y una en fichero dentro de FORJA_HOME solo para tests, que el
  daemon rechaza si no se activa explícitamente con FORJA_KEYCHAIN=file.
- Clave maestra de 32 bytes aleatorios guardada en el Keychain.
- Una clave de datos por tarea y DataClass, envuelta con la clave maestra (AES-256-GCM) y guardada
  en una tabla data_keys. shred(keyId) elimina la clave envuelta.
- Blobs cifrados con AES-256-GCM en FORJA_HOME/blobs/<keyId>/<sha256 del contenido en claro>.
- erase(taskId, dataClass): destruye la clave y añade un evento data.erased (con keyId y motivo,
  sin contenido) en un stream admin.
- Tests: ida y vuelta de un blob; get falla tras shred; data.erased queda en el log;
  el keychain de fichero no se activa sin la variable.

Fuera de alcance: detector de secretos (llega con la trayectoria), endpoint de erase en la API,
retenciones automáticas.

Restricciones: las de AGENTS.md; si durante la construcción algo no encaja con el plan aprobado,
para y pregunta en lugar de decidir; sin ficheros de seguimiento ni memoria propios (odd/, Engram); versiones exactas, con releases de al menos dos semanas;
no modificar tests existentes ni la CI; menos de 300 líneas sin contar el lockfile.

No escribas código todavía. Propón un plan con:
1. Ficheros a crear o modificar.
2. Tests nuevos.
3. Dependencias nuevas con versión exacta y fecha de release (o "ninguna").
4. Tamaño estimado en líneas.
5. Dudas o contradicciones con los ADRs.
```

## PR 7 · feat(daemon): comandos y proyección

```
Tarea: PR 7 de docs/plan-rebanada-1.md — feat(daemon): comandos y proyección.
Lee antes: AGENTS.md y docs/adr/004 (reglas del flujo y almacenamiento).

Objetivo: el manejador de comandos que une decider, blobs y event store.
- handleCommand(actor, cmd): guarda los textos como blobs (null si están vacíos), carga el stream,
  aplica evolve, llama a decide y hace append. Si decide devuelve un error, no escribe nada en el log.
  Los blobs huérfanos de un comando rechazado se aceptan por ahora.
- Asignación del número de tarea secuencial dentro de la misma transacción.
- Proyección tasks (número, título, estado, riesgo, repo, rama base, streamVersion, fechas)
  actualizada en la misma transacción que el append.
- rebuild(): reconstruye la proyección desde readAll.
- Tests: ciclo crear, editar, enviar y rechazar; un comando inválido no deja eventos;
  rebuild da el mismo resultado que la proyección incremental.

Fuera de alcance: API, autenticación, CLI.

Restricciones: las de AGENTS.md; si durante la construcción algo no encaja con el plan aprobado,
para y pregunta en lugar de decidir; sin ficheros de seguimiento ni memoria propios (odd/, Engram); versiones exactas, con releases de al menos dos semanas;
no modificar tests existentes ni la CI; menos de 300 líneas sin contar el lockfile.

No escribas código todavía. Propón un plan con:
1. Ficheros a crear o modificar.
2. Tests nuevos.
3. Dependencias nuevas con versión exacta y fecha de release (o "ninguna").
4. Tamaño estimado en líneas.
5. Dudas o contradicciones con los ADRs.
```

## PR 8 · feat(daemon): API

```
Tarea: PR 8 de docs/plan-rebanada-1.md — feat(daemon): API.
Lee antes: AGENTS.md y docs/adr/005 entero.

Objetivo: la API de comandos y consultas sobre el socket Unix.
- Primer arranque: crea FORJA_HOME con permisos 0700, la clave maestra, la tabla users con el
  usuario usr_…, y un token aleatorio. En la base de datos se guarda solo el hash del token;
  el token va a FORJA_HOME/credentials con permisos 0600.
- Hono sobre @hono/node-server escuchando en FORJA_HOME/run/forja.sock.
- Middleware de autenticación: Bearer obligatorio, comparación en tiempo constante, 401 si falta
  o no es válido. El actor sale del token, nunca del cuerpo.
- Rutas del ADR-005: POST /v1/tasks, PATCH /v1/tasks/:n, POST …/submit, POST …/reject,
  GET /v1/tasks, GET /v1/tasks/:n, GET /v1/tasks/:n/events.
- If-Match con streamVersion en los comandos sobre una tarea existente: 428 si falta, 409 si no coincide.
- Errores RFC 9457 con el code del DomainError; X-Request-Id como correlationId.
- Exporta el tipo de la app para el cliente de la CLI.
- Tests con app.request() para las rutas, y uno sobre el socket real.

Fuera de alcance: SSE, Idempotency-Key, verify-log, health (PR 9).

Restricciones: las de AGENTS.md; si durante la construcción algo no encaja con el plan aprobado,
para y pregunta en lugar de decidir; sin ficheros de seguimiento ni memoria propios (odd/, Engram); versiones exactas, con releases de al menos dos semanas;
no modificar tests existentes ni la CI; menos de 300 líneas sin contar el lockfile.

No escribas código todavía. Propón un plan con:
1. Ficheros a crear o modificar.
2. Tests nuevos.
3. Dependencias nuevas con versión exacta y fecha de release (o "ninguna").
4. Tamaño estimado en líneas.
5. Dudas o contradicciones con los ADRs.
```

## PR 9 · feat(daemon): eventos, idempotencia y admin

```
Tarea: PR 9 de docs/plan-rebanada-1.md — feat(daemon): eventos, idempotencia y admin.
Lee antes: AGENTS.md y docs/adr/005 (endpoints y convenciones).

Objetivo: completar la API de la rebanada 1.
- GET /v1/events: SSE desde readAll, con id = seq, reanudación con Last-Event-ID y un latido
  periódico para mantener viva la conexión.
- Idempotency-Key en POST /v1/tasks: la misma clave con el mismo cuerpo devuelve la respuesta
  original; con otro cuerpo, 422.
- POST /v1/admin/verify-log y GET /v1/health (versión del daemon y del esquema).
- Tests: reanudación con Last-Event-ID, reintento idempotente, verify-log en verde y tras una
  manipulación.

Fuera de alcance: CLI.

Restricciones: las de AGENTS.md; si durante la construcción algo no encaja con el plan aprobado,
para y pregunta en lugar de decidir; sin ficheros de seguimiento ni memoria propios (odd/, Engram); versiones exactas, con releases de al menos dos semanas;
no modificar tests existentes ni la CI; menos de 300 líneas sin contar el lockfile.

No escribas código todavía. Propón un plan con:
1. Ficheros a crear o modificar.
2. Tests nuevos.
3. Dependencias nuevas con versión exacta y fecha de release (o "ninguna").
4. Tamaño estimado en líneas.
5. Dudas o contradicciones con los ADRs.
```

## PR 10 · feat(cli): comandos

```
Tarea: PR 10 de docs/plan-rebanada-1.md — feat(cli): comandos.
Lee antes: AGENTS.md y docs/adr/005 (sección de la CLI).

Objetivo: el comando forja de la rebanada 1.
- Cliente tipado con hc sobre el socket Unix. Propón cómo hacer el fetch sobre el socket
  (node:http o undici) y justifícalo.
- forja daemon start | stop | status: arranque en segundo plano, fichero de PID en
  FORJA_HOME/run y espera a que /v1/health responda.
- forja task new | edit | submit | reject | show, forja status, forja watch y
  forja admin verify-log, con los flags del ADR-005. Argumentos con parseArgs de node:util.
- task edit sin flags abre $EDITOR con una plantilla.
- Mensajes de error legibles a partir del problem+json de la API.
- Tests de los comandos contra un daemon de prueba.

Fuera de alcance: el test de extremo a extremo completo (PR 11).

Restricciones: las de AGENTS.md; si durante la construcción algo no encaja con el plan aprobado,
para y pregunta en lugar de decidir; sin ficheros de seguimiento ni memoria propios (odd/, Engram); la CLI nunca abre el SQLite ni toca git; versiones exactas,
con releases de al menos dos semanas; no modificar tests existentes ni la CI;
menos de 300 líneas sin contar el lockfile.

No escribas código todavía. Propón un plan con:
1. Ficheros a crear o modificar.
2. Tests nuevos.
3. Dependencias nuevas con versión exacta y fecha de release (o "ninguna").
4. Tamaño estimado en líneas.
5. Dudas o contradicciones con los ADRs.
```

## PR 11 · test: extremo a extremo de la rebanada 1

```
Tarea: PR 11 de docs/plan-rebanada-1.md — test: extremo a extremo de la rebanada 1.
Lee antes: AGENTS.md y docs/adr/005 (criterio de hecho).

Objetivo: un test que demuestre el criterio de hecho del ADR-005, con FORJA_HOME temporal y
FORJA_KEYCHAIN=file, arrancando el daemon real y usando la CLI como lo haría una persona:
- Crear, editar y enviar a planificación una tarea; crear y rechazar otra.
- verify-log en verde, y detección de una manipulación.
- Tras erase, el blob afectado no se puede leer.
- Una petición sin token y otra con un token inválido reciben 401.

Fuera de alcance: código de producción. Si el test descubre un fallo, para y descríbelo;
el arreglo va en otro PR.

Restricciones: las de AGENTS.md; si durante la construcción algo no encaja con el plan aprobado,
para y pregunta en lugar de decidir; sin ficheros de seguimiento ni memoria propios (odd/, Engram); versiones exactas, con releases de al menos dos semanas;
no modificar tests existentes ni la CI; menos de 300 líneas sin contar el lockfile.

No escribas código todavía. Propón un plan con:
1. Ficheros a crear o modificar.
2. Tests nuevos.
3. Dependencias nuevas con versión exacta y fecha de release (o "ninguna").
4. Tamaño estimado en líneas.
5. Dudas o contradicciones con los ADRs.
```
