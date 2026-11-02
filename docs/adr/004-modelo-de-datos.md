# ADR-004: Modelo de datos de forja

2 de noviembre de 2026 · Arian

## Estado y contexto

**Estado:** aprobado el 2 de noviembre de 2026.

El ADR-001 fija que todo es un evento (regla 6): el estado de una tarea es una proyección de un log append-only. Este ADR define ese log, las entidades que se derivan de él y cómo se guardan. Debe cumplir:

- Las entidades mínimas del ADR-001: tarea, plan versionado, sesión de agente, workspace, ejecución de gate, decisión humana o delegada y evento.
- Los cuatro requisitos del modo equipo (`docs/contexto.md`, sección 9): actor en cada evento, CLI solo contra la API, almacenamiento y workspace detrás de interfaces.
- Especialista versionado; cada sesión registra runtime, versión, modelo y especialista con su versión.
- Toda decisión de pedir cambios o rechazar, y todo fallo de tarea, guarda un motivo con categoría y texto libre.
- `core` sin infraestructura (ADR-002): las reglas del flujo se prueban sin base de datos.

Añade dos requisitos que salen de revisar el diseño frente a SOC 2, ISO/IEC 27001:2022 e ISO/IEC 27701:2025. Ninguno de los tres certifica software, sino organizaciones; el objetivo es no impedir que una organización que use forja los cumpla:

- El log debe detectar manipulaciones, no solo impedir modificaciones accidentales.
- Los datos personales y los secretos deben poder borrarse aunque el log sea inmutable.

## Decisión: event sourcing con un stream por tarea

Cada evento pertenece a un stream: `task:<n>` para las tareas y `specialist:<id>` para los especialistas. El `streamVersion` permite concurrencia optimista, que el modo equipo necesitará. Las entidades son proyecciones; nada se guarda fuera del log salvo los blobs que el log referencia.

```typescript
// core/src/model/ids.ts
export type TaskId = number;                // secuencial: #12, rama forja/12-filtro-fecha
export type SessionId = `ses_${string}`;    // ULID
export type WorkspaceId = `wsp_${string}`;
export type GateRunId = `gr_${string}`;
export type UserId = `usr_${string}`;       // seudónimo: nombre y email viven en una tabla borrable

// Requisito de modo equipo nº 1: todo evento lleva actor.
export type Actor =
  | { kind: "human"; userId: UserId }
  | { kind: "agent"; sessionId: SessionId; role: AgentRole }  // planner | builder | reviewer
  | { kind: "system"; component: "gates" | "integrator" | "merger" | `adapter:${string}` };

export interface EventEnvelope<T extends string, P> {
  seq: number;            // orden global (proyecciones, SSE)
  stream: string;         // "task:12"
  streamVersion: number;  // concurrencia optimista
  type: T;
  schemaVersion: number;  // migrar payloads al leer, sin reescribir el log
  actor: Actor;
  at: string;             // ISO 8601 UTC
  correlationId?: string; // la petición de API que lo originó
  payload: P;
}
type E<T extends string, P> = EventEnvelope<T, P>;
```

El contenido grande o sensible nunca va en el payload: va a un blob y el payload guarda su referencia.

```typescript
export type DataClass = "task_text" | "untrusted_input" | "trajectory" | "gate_evidence" | "prompt";
export interface BlobRef {
  hash: `sha256:${string}`;   // del contenido en claro, para deduplicar y verificar
  keyId: string;              // clave con la que está cifrado
  dataClass: DataClass;       // decide la retención
}
```

## Eventos y entidades

Los eventos van en pasado y cada transición del ADR-001 corresponde a uno concreto.

```typescript
// core/src/model/task-events.ts
export type RiskLevel = "low" | "medium" | "high";
export type TaskState =
  | "draft" | "planning" | "plan_review" | "building"
  | "verifying" | "review" | "merged" | "failed" | "rejected";

// Códigos en inglés, como los estados. Etiquetas: malentendido, alcance, lógica, tests, estilo, otro.
export type ReasonCategory = "misunderstanding" | "scope" | "logic" | "tests" | "style" | "other";
export interface Reason { category: ReasonCategory; text: BlobRef }  // texto libre: puede contener PII

export type TaskSource =
  | { kind: "cli" }
  | { kind: "github_issue"; repo: string; number: number; url: string;
      untrustedBody: BlobRef };  // entrada no fiable: nunca se mezcla con instrucciones

export type TaskEvent =
  | E<"task.created", { title: string; description: BlobRef; acceptanceCriteria: BlobRef;
                        risk: RiskLevel; repo: string; baseBranch: string; source: TaskSource }>
  | E<"task.edited", Partial<{ title: string; description: BlobRef; acceptanceCriteria: BlobRef }>>
  | E<"task.submitted", {}>                                          // draft → planning
  | E<"task.risk_changed", { from: RiskLevel; to: RiskLevel; cause: "manual" | "diff"; paths: string[] }>
  | E<"session.started", SessionStarted>
  | E<"session.ended", { sessionId: SessionId; outcome: "completed" | "failed" | "cancelled" | "timeout";
                         usage: Usage; trajectoryEvents: number }>
  | E<"plan.proposed", Plan>                                         // planning → plan_review
  | E<"workspace.created", Workspace>
  | E<"build.submitted", { cycle: number; headSha: string }>         // building → verifying
  | E<"gate.completed", GateRun>
  | E<"verification.completed", { cycle: number; headSha: string; passed: boolean }>
  | E<"pr.opened", { number: number; url: string; headSha: string; planVersion: number }>
  | E<"base.integrated", { baseSha: string; result: "clean" | "conflict"; touchesTaskFiles: boolean }>
  | E<"decision.recorded", Decision>                                 // gates 1 y 2
  | E<"task.merged", { prNumber: number; mergeSha: string }>
  | E<"task.failed", { cycle: number; failedGates: GateRunId[] }>
  | E<"failure.classified", { reason: Reason }>
  | E<"task.rejected", { reason: Reason }>
  | E<"workspace.released", { workspaceId: WorkspaceId }>;
```

```typescript
export interface SessionStarted {
  sessionId: SessionId;
  role: AgentRole;
  cycle: number | null;                                   // null en planning
  runtime: { id: string; version: string };               // "claude-agent-sdk", versión exacta (ADR-003)
  model: string;
  specialist: { id: string; version: number; hash: `sha256:${string}` }; // "generic-builder"@1 hasta el piloto
  workspaceId: WorkspaceId | null;
  prompt: BlobRef;                                        // la sesión es reproducible
  policy: BlobRef;                                        // ToolPolicy efectiva
}

export interface Plan {
  planVersion: number;        // cada "pide cambios" produce la siguiente
  sessionId: SessionId;
  files: { path: string; change: "add" | "modify" | "delete" }[];
  newTests: string[];
  approach: BlobRef;
  estimatedLines: number;     // > 300 → se parte en plan_review
}

export interface Workspace {
  workspaceId: WorkspaceId;
  kind: "worktree";           // requisito nº 4: "container" | "cloud_sandbox" más adelante
  ref: string;                // ruta, o id del sandbox
  branch: string;
  baseSha: string;
}

export type GateId = "test_integrity" | "plan_contract" | "diff_size" | "typecheck" | "lint" | "test";
export interface GateRun {
  gateRunId: GateRunId;
  cycle: number;
  headSha: string;
  gate: GateId;
  status: "pass" | "fail" | "error";  // error = el gate no pudo ejecutarse
  summary: string;
  evidence: BlobRef | null;
  durationMs: number;
}

export interface Decision {
  gate: "plan" | "review";
  verdict: "approve" | "request_changes" | "reject";
  mode: "binding" | "shadow";         // shadow: revisor delegado en modo sombra; no mueve la tarea
  subject: { planVersion: number } | { prNumber: number; headSha: string };
  reason?: Reason;                    // obligatorio salvo en approve
  findings?: { path?: string; line?: number; severity: "blocking" | "minor"; text: BlobRef }[];
}
```

Quién decide lo dice el `actor` del evento: una decisión del revisor delegado lleva `kind: "agent"` con `role: "reviewer"`. Los especialistas tienen su propio stream con un único evento, `specialist.version_published`; cada versión es inmutable y se identifica por el hash de su contenido.

## Reglas del flujo en core

Las reglas del ADR-001 son un decider puro: `decide` valida un comando contra el estado y devuelve eventos o un error; `evolve` aplica un evento al estado. Cada regla del ADR-001 queda como test unitario de estas funciones.

```typescript
// core/src/flow/decider.ts — sin base de datos, git ni agentes
export function evolve(view: TaskView, event: TaskEvent): TaskView;
export function decide(view: TaskView, cmd: TaskCommand, policy: FlowPolicy): TaskEvent[] | DomainError;

export interface FlowPolicy { maxLines: 300; maxFailedCycles: 3 }
```

Cuatro precisiones sobre el ADR-001:

1. **Ciclo fallido.** Solo cuenta para el límite de 3 una `verification.completed` con `passed: false` en la que algún gate da `fail`. No cuentan un `error` de infraestructura, un "pide cambios" en `review` ni un conflicto al integrar `dev`: ninguno es fallo del agente.
2. **Motivo de un `failed`.** forja no sabe si una tarea falló por un malentendido o por el alcance. `task.failed` guarda la causa técnica (los gates que fallaron) y el humano la clasifica después con `failure.classified`. Una proyección lista las tareas fallidas sin clasificar.
3. **Una ejecución por gate.** El ADR-001 habla de una ejecución de gate por ciclo. Se registra un `GateRun` por cada gate dentro del ciclo y `verification.completed` los agrupa, para que cada gate tenga su evidencia y su duración.
4. **Modo sombra.** Una decisión con `mode: "shadow"` se guarda pero no mueve la tarea. La proyección `shadow_agreement` compara, por nivel de riesgo, la decisión del revisor delegado con la vinculante y lleva la racha de coincidencias: de ahí sale el criterio de las 20 tareas seguidas.

`decide` exige `reason` en todo `request_changes`, `reject` y `task.rejected`, y rechaza un `approve` en `plan_review` si el plan estima más de 300 líneas. En el modo equipo podrá imponer además que quien aprueba no sea quien creó la tarea.

## Almacenamiento

Las interfaces viven en `core` y la implementación en `daemon` (requisito nº 3): SQLite ahora, Postgres en el modo equipo.

```typescript
export interface EventStore {
  append(stream: string, expectedVersion: number, events: NewEvent[]): Promise<StoredEvent[]>;
  readStream(stream: string, fromVersion?: number): AsyncIterable<StoredEvent>;
  readAll(fromSeq?: number): AsyncIterable<StoredEvent>;   // proyecciones y SSE de la API
  verify(): Promise<{ ok: true } | { ok: false; brokenAt: number }>;
}
export interface BlobStore {
  put(bytes: Uint8Array, dataClass: DataClass, subject?: UserId): Promise<BlobRef>;
  get(ref: BlobRef): Promise<Uint8Array>;     // falla si la clave se ha destruido
  shred(keyId: string): Promise<void>;        // borrado por destrucción de clave
}
```

```sql
CREATE TABLE events (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  stream         TEXT    NOT NULL,
  stream_version INTEGER NOT NULL,
  type           TEXT    NOT NULL,
  schema_version INTEGER NOT NULL,
  actor          TEXT    NOT NULL,  -- JSON
  at             TEXT    NOT NULL,
  correlation_id TEXT,
  payload        TEXT    NOT NULL,  -- JSON, sin PII ni secretos: solo BlobRef
  prev_hash      TEXT    NOT NULL,  -- hash del evento seq-1 (génesis: 64 ceros)
  hash           TEXT    NOT NULL,  -- sha256(prev_hash || JSON canónico del envelope)
  UNIQUE (stream, stream_version)
);
CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'append-only'); END;

-- Trayectoria del agente: alto volumen, append-only, mismos triggers y su propia cadena por sesión
CREATE TABLE agent_events (
  session_id TEXT    NOT NULL,
  seq        INTEGER NOT NULL,
  at         TEXT    NOT NULL,
  kind       TEXT    NOT NULL,  -- tool_call | tool_result | message | denied | usage
  payload    TEXT    NOT NULL,  -- BlobRef de clase trajectory
  prev_hash  TEXT    NOT NULL,
  hash       TEXT    NOT NULL,
  PRIMARY KEY (session_id, seq)
);
```

- **Cadena de hashes.** Los triggers evitan cambios accidentales; la cadena detecta los deliberados. Es global sobre `seq`, así que las escrituras se serializan, algo que forja ya hace. El JSON canónico sigue RFC 8785. `forja admin verify-log` recorre la cadena; en el modo equipo se publica periódicamente el último hash fuera del servidor.
- **Trayectoria separada.** La regla 6 se mantiene: cada acción del agente queda en un log append-only. Va en `agent_events` porque una sesión genera miles de acciones que no cambian el estado de la tarea; el log de dominio solo registra el inicio y el fin de la sesión. Incluye las acciones denegadas por los hooks (ADR-003), materia prima del monitor de trayectoria.
- **Proyecciones.** `tasks`, `plans`, `sessions`, `gate_runs`, `decisions`, `workspaces`, `shadow_agreement` y `unclassified_failures` se actualizan en la misma transacción que el `append`, así que la API nunca lee un estado distinto del log. `forja admin rebuild` las reconstruye desde cero.
- **API.** Por el requisito nº 2, la API expone las proyecciones y emite `readAll` por SSE. La CLI nunca abre el SQLite.

## Datos personales y secretos

El log no guarda datos personales ni secretos: solo referencias a blobs cifrados, que se pueden borrar destruyendo su clave (crypto-shredding). Así el log sigue siendo inmutable y forja puede atender una supresión del RGPD (artículo 17).

- **Clave por tarea y clase de dato.** Cada combinación tarea × `DataClass` tiene su clave. Borrar la trayectoria de la tarea 12 es destruir una clave, sin tocar el log.
- **Actores seudónimos.** El log solo guarda `usr_…`; nombre y email viven en la tabla `users`, que sí se puede borrar.
- **Claves fuera del workspace.** La clave maestra va en el Llavero de macOS en local y en un KMS en el modo equipo. Nunca entra en el workspace del agente (ADR-003).
- **Redacción de secretos antes de guardar.** Todo blob de clase `trajectory`, `gate_evidence` o `prompt` pasa por un detector de secretos con reglas tipo gitleaks; lo detectado se sustituye por `[REDACTED:<regla>]`.
- **Borrado registrado.** `forja admin erase --task 12 --class untrusted_input` destruye la clave y añade un evento `data.erased` con los `keyId` y el motivo, sin el contenido.

| Clase | Qué contiene | Retención propuesta |
| --- | --- | --- |
| `task_text` | Descripción, criterio de aceptación, enfoque del plan, motivos, hallazgos | Mientras exista la tarea |
| `untrusted_input` | Cuerpo de issues y otras fuentes externas | 1 año |
| `gate_evidence` | Salidas de typecheck, lint y tests | 1 año |
| `prompt` | Prompt completo de cada sesión | 90 días |
| `trajectory` | Acciones del agente, incluidas las denegadas | 90 días |

Las retenciones son una propuesta propia, no salen de ninguna norma: se fijan con quien responda de la privacidad antes del modo equipo. Un job diario destruye las claves caducadas. Los eventos de dominio se conservan siempre, porque no contienen PII.

## Alternativas descartadas

| Alternativa | Por qué se descarta |
| --- | --- |
| Tablas CRUD con un log de auditoría aparte | El estado y el log pueden divergir, y la regla 6 del ADR-001 exige que el estado sea una proyección del log. |
| Un único log con la trayectoria del agente dentro | Miles de eventos por sesión que no cambian el estado: reconstrucciones lentas y un log de dominio difícil de leer. Opinión propia, revisable. |
| Proyecciones asíncronas (un proceso aparte que lee el log) | Lecturas desfasadas tras cada comando sin necesidad: con un solo daemon, actualizar en la misma transacción es más simple. |
| Payloads en claro y borrado reescribiendo el log | Rompe la inmutabilidad y la cadena de hashes. El crypto-shredding borra sin tocar el log. |
| Una base de datos de event sourcing dedicada (EventStoreDB y similares) | Otra pieza que desplegar para un daemon local de un usuario. La interfaz `EventStore` permite cambiar si hiciera falta. |
| Ids de tarea ULID | Ilegibles en la CLI y en los nombres de rama. Un número secuencial basta con un solo daemon por instalación. |

## Consecuencias y riesgos

- Las reglas del flujo se prueban como funciones puras en `core`, sin base de datos, git ni agentes.
- El trailer `Assisted-by` sale de `session.started`: `runtime.id` y `model`.
- Cada payload lleva `schemaVersion`; los cambios de forma se resuelven con funciones de migración al leer, nunca reescribiendo el log.
- Riesgo: la clave maestra se pierde y con ella todos los blobs. Mitigación: copia de seguridad de la clave separada de la del SQLite.
- Riesgo: el detector de secretos no detecta un formato. Mitigación: retención corta de trayectorias y prompts, y un borrado puntual con `forja admin erase`.
- Lo que no resuelve este ADR, y queda en el backlog del modo equipo: cifrado del servidor, autenticación y autorización en la API, copias de seguridad, sincronización de relojes y gestión de proveedores de modelos.

Qué entra en cada rebanada, sin cambiar el esquema:

| Rebanada | Eventos | Proyecciones |
| --- | --- | --- |
| 1. Tareas y log | `task.created`, `task.edited`, `task.submitted`, `task.rejected` | `tasks` |
| 2. Planificación | `session.*`, `plan.proposed`, `decision.recorded` (gate 1) | `plans`, `sessions`, `decisions` |
| 3. Construcción y verificación | `workspace.*`, `build.submitted`, `gate.completed`, `verification.completed`, `task.failed`, `failure.classified`, `task.risk_changed` | `workspaces`, `gate_runs`, `unclassified_failures` |
| 4. PR y merge | `pr.opened`, `base.integrated`, `decision.recorded` (gate 2), `task.merged` | `shadow_agreement` (desde el paso 8) |

La cadena de hashes, los blobs cifrados y la tabla `users` entran en la rebanada 1: añadirlos con datos ya escritos no es posible de forma limpia.
