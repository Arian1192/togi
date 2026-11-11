# ADR-012: Triage de la entrada

11 de noviembre de 2026 · Arian

## Estado y contexto

**Estado:** aprobado el 11 de noviembre de 2026, el mismo día en que se propuso.

Hoy una tarea llega a `draft` de dos sitios, la CLI y los issues de GitHub (ADR-001, origen de las tareas), y el humano la completa a mano: criterio de aceptación, riesgo y alcance. Con los issues de GitHub ese trabajo es el cuello de botella antes de la línea: muchos llegan incompletos, repetidos o fuera de alcance, y su texto es entrada no fiable.

La idea sale de Multica, que está construyendo un «Triage» propio (flag `triage_v1`, diseño MUL-7189, aún sin publicar). Tomamos tres decisiones suyas:

- El triage no es un estado del trabajo, sino una pregunta aparte: «¿esto es trabajo siquiera?» frente a «¿cuánto ha avanzado?».
- Lo que deja el triager es una **propuesta**; la confirma una persona al aceptar.
- Mientras una entrada está en triage, **nada se ejecuta** a partir de ella.

Lo que Multica no tiene y togi sí: sandbox, un decider que impone las reglas y un log de eventos. Por eso aquí el triager tiene menos poder que en Multica.

En una planta, es el control de calidad de la materia prima: lo que entra se inspecciona, se clasifica y se aparta lo defectuoso antes de que llegue a fabricación.

## Decisiones

### 1. Un rol nuevo, `triager`, evaluador de la entrada

Se añade a la lista cerrada de roles del ADR-009:

| Rol | Familia | Recibe | Produce | Nunca puede |
| --- | --- | --- | --- | --- |
| Triager | Evaluador de la entrada | La tarea en `draft`, su origen y la lista de tareas abiertas del repo | Una propuesta de triage | Crear, editar, enviar o rechazar una tarea; escribir; usar la red |

- **Herramientas:** `Read`, `Glob` y `Grep` sobre la copia de solo lectura del repo, las mismas del planificador. Sin `Bash`, sin escritura y sin red, también dentro del sandbox del ADR-008.
- **Especialista por defecto:** `generic-triager@1`, con el modelo y el esfuerzo del planificador.
- **Por qué no es el analista del ADR-009:** el analista trabaja sobre una idea tuya, que es fiable, y produce una especificación. El triager juzga texto externo, que no lo es, y produce una propuesta con campos cerrados. Tener menos poder es justo lo que lo hace seguro.

### 2. El triage no es un estado de la tarea

Los estados del ADR-001 no cambian. La tarea sigue en `draft` y lleva aparte su triage, con tres valores:

- `pending`: togi ha pedido el triage y aún no hay propuesta.
- `proposed`: el triager ha dejado su propuesta.
- `accepted`: el humano la ha resuelto.

Una tarea sin triage es una tarea normal, como todas las de hoy.

### 3. Cuándo se hace

Lo decide la configuración del flujo del repo (ADR-009), nunca un agente. Por defecto:

- Activado para el origen `github_issue`, porque su texto no es fiable.
- Desactivado para `cli` y `rework`: los escribes tú, o vienen de una tarea fallida que ya clasificaste.

### 4. Nada avanza mientras está en triage

El decider aplica la regla:

- **`submit` se rechaza** en `pending` y `proposed` con `in_triage`.
- **La única sesión que se abre es la del triager.**
- **Tú puedes editar la tarea en cualquier momento.** La propuesta no bloquea tus cambios.

### 5. Qué propone el triager

Una estructura cerrada, validada por esquema. No es texto libre que togi tenga que interpretar.

- **Si está completa:** `ready` o `needs_info`. Si falta algo, lo indica de una lista cerrada: `reproduction`, `expected_behavior`, `acceptance_criteria`, `scope` o `environment`.
- **Recomendación:** `accept`, `ask_info`, `duplicate` o `decline`.
- **Criterio de aceptación propuesto**, como blob.
- **Riesgo propuesto y áreas del repo**, como rutas, con su porqué.
- **Duplicados:** como mucho cinco, y solo de la lista que togi le dio. Un id que no esté en esa lista se rechaza.
- **Demasiado grande:** una marca que sugiere partir la tarea.
- **Razonamiento:** una explicación corta, como blob.

### 6. Tú resuelves

- **Aceptar:** togi aplica a la tarea los campos de la propuesta que elijas, o los tuyos si los corriges. La tarea queda lista para `submit`.
- **Rechazar:** es el `task.rejected` de siempre. Se añaden dos categorías de motivo, `duplicate` y `not_actionable`, para que el rechazo enseñe algo.
- **Pedir información:** togi te muestra qué falta. En este ADR togi no escribe en GitHub: la respuesta al autor del issue la das tú.
- **Repetir el triage:** después de editar la tarea, o si no te convence la propuesta. Rehacer el triage no es reintentarlo: es otra petición.

### 7. Reintentos

Es la misma regla del planificador (U5):

- Una caída pasajera se reintenta sola una vez.
- Cualquier otro fallo deja el triage en `pending`, a la espera de que lo repitas tú.

### 8. Texto no fiable

- **El cuerpo del issue llega al triager como dato,** separado de sus instrucciones, como ya hace el planificador con `untrustedBody`.
- **Lo que el triager escribe también es no fiable.** El criterio de aceptación que propone viene marcado en la app y en la CLI como «propuesto a partir de texto externo».
- **Aceptar es la frontera de confianza:** un campo propuesto no llega al plan sin que tú lo aceptes.
- **Contexto para los duplicados:** togi le da los títulos y los ids de las 50 tareas abiertas más recientes del mismo repo. El triager no consulta la API: los agentes nunca hablan con el daemon (ADR-008, punto 5).

### 9. Lo que se aprende

Una proyección, `triage_outcomes`, compara por origen y por especialista la recomendación del triager con tu decisión:

- La tasa de coincidencia.
- Cuántas entradas llegan incompletas, y qué les falta.
- Cuántas son duplicados.
- Qué áreas reciben más entradas.

Es el mismo mecanismo que el modo sombra del revisor (ADR-004, precisión 4). **Este ADR no acepta nada en automático.** Si los datos lo justifican, se decidirá en otro ADR con un criterio como el del ADR-001: 20 coincidencias seguidas.

## Eventos

En el stream de la tarea:

```typescript
  | E<"triage.requested", Record<string, never>>              // system: el flujo pide triage; draft → triage pending
  | E<"triage.proposed", TriageProposal>                       // agent triager, desde su sesión activa
  | E<"triage.accepted", { acceptanceCriteria?: BlobRef; risk?: RiskLevel }>  // human; lo aplicado
  | E<"triage.retry_requested", Record<string, never>>        // human, o system tras una caída pasajera
```

La sesión del triager usa `session.started` y `session.ended`, como las demás, con `role: "triager"`.

## Qué enmienda este ADR

- **ADR-009:** añade el rol `triager` a la lista cerrada, con sus herramientas.
- **ADR-004:** los cuatro eventos, la proyección `triage_outcomes` y las categorías de motivo `duplicate` y `not_actionable`.
- **ADR-001:** precisa que una tarea en `draft` con triage pendiente no se envía.

## Orden de construcción

Va después de la rebanada 3 y no depende de ella. Son cuatro PRs:

1. Core: el rol, los eventos, la vista del triage y las reglas del decider.
2. El especialista `generic-triager@1` y su política de herramientas.
3. El orquestador: pedir el triage al crear la tarea, abrir la sesión y validar la propuesta.
4. La CLI (`togi task triage`) y la tarjeta «En triage» de la mesa, con la propuesta y los botones.

## Alternativas descartadas

| Alternativa | Por qué se descarta |
| --- | --- |
| El triage como un estado más del ADR-001 | Mezcla dos preguntas. Multica empezó así y lo sacó a un campo propio (su migración 483), porque cada lector del estado tenía que excluir el triage. |
| Usar el rol de analista | Otro nivel de confianza: el analista parte de tu idea, el triager de texto externo. Además, el analista llega después del piloto. |
| Aceptar en automático si la recomendación es `accept` | No hay datos de que el triager acierte. Se decide con `triage_outcomes`, en otro ADR. |
| Que el triager comente en el issue de GitHub | Daría red y credenciales a un agente que lee texto no fiable. Si algún día se hace, lo hará el daemon. |
| Que el triager busque duplicados en la API | Los agentes no hablan con el daemon (ADR-008). togi le da la lista. |

## Riesgos y límites conocidos

- **Inyección en el issue:** un texto puede intentar que el triager recomiende `accept` o proponga un riesgo bajo. Lo limitan los campos cerrados, la falta de herramientas y que la decisión sea tuya. No se elimina.
- **Duplicados entre repos:** fuera de alcance; solo se compara con el mismo repo.
- **Coste:** una sesión por cada issue que entra. El tope de sesiones del ADR-011 también lo cubre.
