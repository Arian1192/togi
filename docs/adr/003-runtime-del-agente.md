# ADR-003: Runtime del agente de togi

2 de noviembre de 2026 · Arian

## Estado y contexto

**Estado:** aprobado el 2 de noviembre de 2026.

**Enmienda del 10 de noviembre de 2026 (ADR-011):** el `Bash` del builder solo acepta los comandos de comprobación del perfil del repo, con rutas como argumentos y sin metacaracteres de shell. Su bloqueo de ficheros incluye las rutas protegidas del perfil, con unos mínimos fijos (manifiestos, lockfiles, configuración de los gates, `.github/` y credenciales). El esfuerzo de razonamiento (`effort`) es un campo del especialista.

togi no construye su propio agente: usa uno existente y lo controla. El runtime elegido debe permitir:

- Lanzarlo de forma programática desde el daemon (ADR-002: TypeScript sobre Node).
- Restringir las herramientas según el estado del flujo: `planning` solo lee, `building` escribe.
- Bloquear la edición de tests existentes, de la configuración de gates y de credenciales (principio 4).
- Recibir sus acciones en streaming para registrarlas en el log de eventos (principio 7).
- Que la configuración la decida togi, no un fichero del repo que el agente pueda modificar.

## Decisión

El primer runtime es el Claude Agent SDK de TypeScript (`@anthropic-ai/claude-agent-sdk`), con versión fijada de forma exacta. El daemon nunca lo usa directamente: lo hace a través de la interfaz `AgentRuntime`, para poder añadir otros runtimes sin tocar el núcleo.

```typescript
type AgentRole = "planner" | "builder" | "reviewer";

interface SessionSpec {
  taskId: string;
  role: AgentRole;
  workspacePath: string;   // worktree de la tarea
  prompt: string;          // tarea + plan aprobado + feedback del ciclo anterior
  policy: ToolPolicy;      // herramientas y rutas permitidas, según el estado
}

interface AgentRuntime {
  readonly id: string;     // p. ej. "claude-agent-sdk@x.y.z"
  start(spec: SessionSpec): AsyncIterable<AgentEvent>;  // eventos normalizados -> log
  cancel(sessionId: string): Promise<void>;
}
```

Codex (`@openai/codex-sdk`) es el candidato a segundo runtime, sobre todo como revisor delegado (paso 8): un revisor de otro proveedor no comparte los puntos ciegos del agente que escribió el código.

## Configuración por estado del flujo

El agente solo tiene las herramientas que su estado necesita. Todo lo que no está en la lista se deniega sin preguntar (modo `dontAsk` con `allowedTools`), y los ajustes del repo no se cargan (`settingSources` vacío), así que la configuración la decide togi.

| Estado | Rol | Herramientas permitidas | Bloqueos del hook de togi |
| --- | --- | --- | --- |
| `planning` | planner | `Read`, `Glob`, `Grep` | Ninguno necesario: no puede escribir ni ejecutar. |
| `building` | builder | `Read`, `Glob`, `Grep`, `Edit`, `Write`, `Bash` limitado a los comandos del perfil del repo (typecheck, lint, test) | Edición de tests existentes, configuración de gates, `.github/`, ficheros de credenciales y ficheros fuera del plan aprobado. |
| `review` (revisor delegado) | reviewer | `Read`, `Glob`, `Grep` | Ninguno necesario: no modifica la rama (ADR-001). |

Los hooks del SDK se ejecutan antes que cualquier otra regla de permisos y pueden denegar una acción en cualquier modo. El bloqueo de ficheros fuera del plan en `building` da feedback temprano al agente; el contrato se vuelve a comprobar en `verifying`.

Estas restricciones son una capa de defensa, no la garantía. La garantía es `verifying`, que togi ejecuta en un entorno que el agente no controla.

## Autenticación

| Modo | Credencial | Base |
| --- | --- | --- |
| Uso personal (ahora) | La suscripción de Claude de Arian | Según la ayuda de Anthropic (actualizada en octubre de 2026), con sesión iniciada en un plan de Claude, el Agent SDK consume de los límites de la suscripción. |
| Modo equipo (backlog) | API key de una organización de Claude Console | Anthropic no permite a terceros ofrecer el login de Claude.ai ni usar credenciales de planes Free, Pro o Max en nombre de sus usuarios. |

Los términos han cambiado varias veces en 2026 (en junio se pausó un cambio anunciado), así que se revisan antes de activar el modo equipo. La credencial nunca entra en el workspace del agente.

## Alternativas descartadas

| Alternativa | Por qué se descarta |
| --- | --- |
| Codex como primer runtime | También tiene SDK en TypeScript y es válido. Se prefiere Claude porque es el agente que ya se usa en `promos` y por su control de permisos con hooks. Queda como segundo runtime. |
| Lanzar `claude -p` como proceso y parsear su salida | Menos control: los permisos dependerían de ficheros de ajustes en disco, y el SDK ofrece lo mismo con una API tipada. |
| Construir un bucle de agente propio sobre la API | Contradice la decisión de no construir el agente: togi es todo lo que lo rodea. |
| Usar el runtime directamente, sin interfaz | Ata el núcleo a un proveedor e impide un revisor independiente de otro proveedor. |

## Consecuencias y riesgos

- El modelo de datos (paso 4) incluye una sesión de agente con su runtime y versión, y los eventos normalizados que emite `AgentRuntime`.
- El trailer `Assisted-by` se genera desde el `id` del runtime y el modelo usado.
- Riesgo: el SDK evoluciona rápido. Mitigación: versión fijada y una prueba de humo del runtime antes de actualizarla.
- Riesgo: cambios en los términos de uso. Mitigación: la interfaz permite cambiar de runtime o de credencial sin tocar el núcleo.

## Fuentes

- [Configure permissions, Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Codex SDK](https://developers.openai.com/codex/sdk)
