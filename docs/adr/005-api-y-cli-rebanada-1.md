# ADR-005: API y CLI de la rebanada 1

2 de noviembre de 2026 · Arian

## Estado y contexto

**Estado:** aprobado el 2 de noviembre de 2026.

La rebanada 1 (ADR-004) entrega tareas y log de eventos de punta a punta, todavía sin agente: crear, editar, enviar a planificación, rechazar, consultar y seguir los eventos. Este ADR define la API del daemon y la CLI que la usa. Debe cumplir:

- La CLI habla solo con la API del daemon (requisito nº 2 del modo equipo).
- Cada endpoint corresponde a un comando del decider de `core` (ADR-004).
- Todo evento lleva un actor que no se puede falsificar.
- Los gates no se pueden saltar (principio 4).

El riesgo que condiciona el diseño: el agente se ejecuta con el mismo usuario del sistema que el daemon. Si la API acepta peticiones sin autenticar, cualquier código que escriba el agente, por ejemplo un test de `promos` ejecutado en `building` o en `verifying`, podría aprobar su propio plan. Los permisos de fichero no lo impiden, porque el proceso es del mismo usuario.

## Decisión: transporte y autenticación

El daemon sirve una API HTTP en un socket Unix, `~/.forja/run/forja.sock`, y toda petición lleva un token `Bearer`. No abre ningún puerto TCP, así que ni otro equipo ni una página del navegador pueden alcanzarlo. Cuando llegue la web UI se añadirá `127.0.0.1` con token y comprobación de `Origin`.

La defensa frente al agente tiene tres capas:

1. **Token obligatorio** en todas las peticiones, guardado en `~/.forja/credentials` con permisos `0600`. Entra en esta rebanada.
2. **Sandbox para el agente y los gates.** Sus procesos no pueden leer `~/.forja` ni conectarse al socket. Se implementa en las rebanadas 2 y 3.
3. **Prueba de red teaming** en el criterio de hecho de la rebanada 3: una tarea cuyo código intenta aprobar su propio plan tiene que fallar.

La capa 1 sola no basta: un proceso del mismo usuario puede leer el fichero del token. La garantía la dan las capas 2 y 3 juntas.

El actor de cada evento sale del token, nunca del cuerpo de la petición. En esta rebanada hay un único usuario, `usr_…`, creado en el primer arranque.

## Endpoints de la rebanada 1

Los comandos son `POST` sobre subrecursos de acción y cada uno corresponde a un comando del decider. No hay un `PATCH` genérico del estado: la API solo expone lo que el flujo permite.

| Método y ruta | Comando o consulta | Respuesta |
| --- | --- | --- |
| `POST /v1/tasks` | Crea la tarea en `draft` | `201` con la tarea |
| `PATCH /v1/tasks/:n` | Edita título, descripción o criterio (solo en `draft`) | `200` |
| `POST /v1/tasks/:n/submit` | `draft` → `planning` | `200` |
| `POST /v1/tasks/:n/reject` | Rechaza, con motivo obligatorio | `200` |
| `GET /v1/tasks?state=&limit=` | Lista desde la proyección `tasks` | `200` |
| `GET /v1/tasks/:n` | Detalle, con los textos descifrados | `200` |
| `GET /v1/tasks/:n/events` | Eventos de dominio de la tarea | `200` |
| `GET /v1/events` | SSE de `readAll`; reanuda desde `Last-Event-ID` (= `seq`) | stream |
| `POST /v1/admin/verify-log` | Recorre la cadena de hashes | `200` con `ok` o `brokenAt` |
| `GET /v1/health` | Versión del daemon y del esquema | `200` |

Convenciones:

- **Concurrencia optimista.** Los comandos sobre una tarea llevan `If-Match: <streamVersion>`; si la tarea cambió entre medias, `409`.
- **Idempotencia.** `POST /v1/tasks` acepta `Idempotency-Key`, para que un reintento de la CLI no cree dos tareas.
- **Correlación.** El `X-Request-Id` se guarda como `correlationId` del evento.
- **Errores en RFC 9457** (`application/problem+json`) con el `code` del `DomainError`: `400` validación, `401` sin token válido, `404`, `409` conflicto de versión, `422` regla del flujo (transición inválida, motivo obligatorio, falta el criterio de aceptación).

El ADR-001 exige criterio de aceptación y nivel de riesgo para salir de `draft`, no para entrar. Por eso `POST /v1/tasks` admite crear la tarea sin criterio y es `submit` quien lo exige.

```typescript
// core/src/api/schemas.ts — compartido por daemon y CLI
export const CreateTask = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(20_000).default(""),
  acceptanceCriteria: z.string().max(20_000).default(""),   // obligatorio en submit, no aquí
  risk: z.enum(["low", "medium", "high"]),
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  baseBranch: z.string().default("dev"),
});
export const RejectTask = z.object({
  reason: z.object({ category: ReasonCategory, text: z.string().min(1).max(5_000) }),
});
```

## CLI de la rebanada 1

La CLI es un cliente fino: valida los argumentos, llama a la API con el cliente tipado de Hono y muestra el resultado. Nunca abre el SQLite ni toca git.

```
forja daemon start | stop | status
forja task new "Añadir filtro por fecha" --risk low --repo Arian1192/promos [--base dev]
forja task edit 12 [--title …] [--criteria-file criterio.md]   # sin flags abre $EDITOR
forja task submit 12
forja task reject 12 --category scope --reason "…"
forja task show 12 [--events]
forja status [--state draft]
forja watch                                                    # sigue el SSE
forja admin verify-log
```

En el primer arranque, `forja daemon start`:

- Crea `~/.forja` con permisos `0700`.
- Genera la clave maestra y la guarda en el Llavero de macOS.
- Crea el usuario `usr_…` y su token en `~/.forja/credentials`.
- Crea la base de datos con la cadena de hashes y los triggers append-only.

Los argumentos se leen con `parseArgs` de `node:util`, sin dependencias.

## Dependencias

Pocas y con versión exacta: cada dependencia es código de terceros dentro del proceso que guarda las claves y aprueba merges. Donde Node trae algo estable, se usa. Al instalar se elige una release con al menos dos semanas de antigüedad.

| Pieza | Elección | Por qué |
| --- | --- | --- |
| HTTP | `hono` + `@hono/node-server` | Cliente RPC tipado para la CLI sin generar código, y SSE nativo con `streamSSE` ([guía de Hono](https://www.deployhq.com/guides/hono.md)). |
| Validación | `zod` | Esquemas en `core`, compartidos por daemon y CLI. |
| SQLite | `better-sqlite3` 13.x, detrás de `EventStore` | Maduro y síncrono, lo que encaja con escrituras serializadas y proyecciones en la misma transacción. Desde la 13 usa N-API y publica binarios precompilados ([notas de la 13.0.2](https://github.com/npmx-dev/npmx.dev/pull/3118)). |
| Cifrado | `node:crypto` (AES-256-GCM) | Una clave por tarea y clase de dato, envuelta con la clave maestra. |
| Llavero | Comando `security` de macOS | Sin dependencias nativas. |
| Argumentos | `parseArgs` de `node:util` | Integrado y estable. |
| Tests | `node:test` | Integrado y estable ([índice de estabilidad](https://nodejs.org/api/documentation.html)). |

Hono frente a Fastify es una preferencia propia, no sale de ningún dato: los dos servirían.

## Alternativas descartadas

| Alternativa | Por qué se descarta |
| --- | --- |
| API en `localhost` por TCP sin token | Cualquier proceso local, incluido el código del agente, podría aprobar un plan. También la exponen páginas web mediante DNS rebinding. |
| `PATCH` genérico del estado de la tarea | La API permitiría pedir cualquier transición y tendría que filtrarla. Con un endpoint por comando, lo que no permite el flujo no existe. |
| Actor en el cuerpo de la petición | Cualquiera podría declararse humano. Sin identidad ligada a la credencial, el log no es atribuible. |
| CLI que lee el SQLite directamente | Rompe el requisito nº 2 del modo equipo y duplicaría las reglas fuera del daemon. |
| `node:sqlite` en lugar de `better-sqlite3` | Ahorra una dependencia, pero sigue siendo release candidate ([estabilidad en Node](https://nodejs.org/api/documentation.html)). Se reevalúa cuando sea estable; cambiar solo toca el adaptador. |
| WebSocket para los eventos | El flujo es solo del daemon al cliente. SSE basta, reanuda con `Last-Event-ID` y funciona con `curl`. |
| tRPC u OpenAPI con código generado | El cliente de Hono da los mismos tipos sin un paso de build ni otra pieza. |

## Criterio de hecho y consecuencias

La rebanada 1 está hecha cuando:

- [ ] Cada regla del decider que se aplica a esta rebanada tiene su test unitario en `core`.
- [ ] Un test de extremo a extremo, con un `~/.forja` temporal, recorre con la CLI contra el daemon real: crear, editar, enviar a planificación y rechazar otra tarea.
- [ ] `verify-log` detecta una manipulación: el test quita los triggers, cambia una fila y comprueba que la verificación falla.
- [ ] `erase` destruye la clave y leer el blob afectado falla.
- [ ] Una petición sin token o con un token inválido recibe `401`.

El criterio prueba las propiedades que no se ven en el uso diario (manipulación, borrado, autenticación), no solo el camino feliz.

Consecuencias:

- La CLI y el daemon comparten esquemas y tipos; un cambio de contrato falla al compilar en los dos lados.
- La rebanada 2 añade `POST /v1/tasks/:n/plan/approve` y `…/plan/request-changes` con el mismo patrón, y el sandbox del agente.
- Riesgo: el token es legible por cualquier proceso del usuario hasta que exista el sandbox. Mitigación: en la rebanada 1 no hay agente; la rebanada 2 no arranca un agente sin sandbox.
- Riesgo: un socket Unix no sirve a la web UI ni a un daemon remoto. Mitigación: el transporte es una pieza del daemon; las rutas y el cliente no cambian al añadir TCP.
