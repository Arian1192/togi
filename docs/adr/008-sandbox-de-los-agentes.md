# ADR-008: Sandbox y ejecución de los agentes

4 de noviembre de 2026 · Arian

## Estado y contexto

**Estado:** aprobado el 4 de noviembre de 2026.

**Enmienda del 10 de noviembre de 2026 (ADR-011):** en la rebanada 3 el builder y los gates usan `srt`, siempre que antes pasen dentro de él la instalación, el typecheck, el lint y los tests de `promos`. Además de la copia de solo lectura, cada tarea tiene una copia escribible (el árbol de su clon, sin el directorio de git). La instalación de dependencias, que es una ejecución aparte sin agente, es la única que tiene red, y solo hacia los dominios exactos del registro del perfil. microsandbox se evalúa con el gate del navegador.

El ADR-005 fijó una condición antes de la rebanada 2: ningún agente se lanza sin sandbox. Un agente que lee un repo puede encontrar instrucciones maliciosas en él, y lo que puede hacer en ese caso lo decide su aislamiento. Lo que el sandbox debe impedir, de más a menos grave:

1. Leer la clave maestra de togi en el Llavero.
2. Leer `~/.togi`, sobre todo el token, o conectarse al socket o a un puerto local del daemon, porque con eso podría aprobar su propio trabajo.
3. Leer otros secretos del usuario: `~/.ssh`, credenciales de la nube, del navegador.
4. Sacar información por la red, incluido el DNS, salvo hacia la API del modelo.
5. Escribir fuera de su espacio de trabajo.

La decisión se ha tomado con un experimento: la misma batería de pruebas, con control positivo, sobre dos candidatos y dos modos de credenciales. Los resultados completos están en [`docs/research/2026-11-experimento-sandbox.md`](../research/2026-11-experimento-sandbox.md).

## Decisión

### 1. Una interfaz `Sandbox` que no conoce al proveedor

El sandbox recibe una especificación y no sabe qué agente ejecuta:

- **Lectura:** las rutas de la copia del repo y del código del agente, en solo lectura. La copia se exporta con `git archive`, no con `git worktree`: un checkout ejecutaría los hooks del repo (también los de `core.hooksPath`) en el daemon, fuera del sandbox. Nada más de la carpeta del usuario, ni lo que está fuera de ella: `/Users`, `/Volumes`, `/tmp` y las carpetas temporales del usuario también se deniegan.
- **Escritura:** un único directorio desechable por ejecución, que también es el `HOME` y el directorio temporal del agente.
- **Red:** una lista blanca de nombres exactos de dominio, nunca sufijos. Sin DNS abierto, sin sockets Unix y sin puertos locales.
- **Entorno:** una lista blanca de variables. Ninguna variable del usuario llega al agente si no está en ella.
- **Credenciales:** las que haya que ocultar, con los dominios en los que se inyectan.
- **Límites:** tiempo máximo de la ejecución.

El sandbox es **desechable y sin estado propio**. Todo lo que importa vive fuera: el código en git y la historia en el log de eventos. Así, cualquier implementación futura, incluido un substrate de ejecución, puede alojar los sandboxes de togi sin rediseñar nada.

### 2. Primera implementación: Anthropic Sandbox Runtime (`srt`)

Para la rebanada 2, en la que el agente solo lee el repo y propone un plan. Versión fijada, con la regla de las dos semanas de antigüedad. Configuración obligatoria:

- `denyRead` de la carpeta personal completa, de `/Users`, `/Volumes`, `/tmp` y de la carpeta temporal del usuario (`/var/folders/xx/yyyy`), con `allowRead` explícito de las rutas de la copia del repo, del agente y del entorno de ejecución.
- `allowWrite` solo del directorio desechable.
- Sockets Unix bloqueados y sin `allowLocalBinding`.
- Red solo hacia los dominios del runtime.
- Para la clave de API, `credentials.envVars` en modo `mask` con `tlsTerminate`: el agente solo ve un marcador.

Se elige por tres motivos: pasó toda la batería, incluido el Llavero; tiene menos formas de configurarse mal que la alternativa; y es ligero (80-130 ms de arranque) y ejecuta al agente en el mismo sistema que el usuario.

### 3. Segunda implementación prevista: microsandbox

A evaluar en la rebanada 3, cuando el agente ejecute tests y código del repo, porque ahí un límite de máquina virtual vale más. El experimento fija sus reglas de configuración obligatorias:

- Nunca `Rule.allowDns()` ni los perfiles `public`, `private` o `host`: con ellos, el DNS permite exfiltrar datos.
- Interceptación TLS en el puerto 443 para los dominios permitidos, con `strict` activo.
- Nunca el grupo `host` ni `allowAll`: con ellos, la VM alcanza todo lo que escucha en el loopback del Mac, incluido el daemon de togi.
- Reglas por nombre exacto (`allowDomain`), nunca por sufijo.

### 4. El trabajador de agentes, separado del daemon

El agente se ejecuta en un proceso trabajador distinto del daemon, aunque al principio corra en la misma máquina. Se comunica con togi **solo por su entrada y salida estándar**: nunca tiene red hacia el daemon. Esto permite mover el trabajador a un servidor remoto más adelante como cambio de configuración, no de arquitectura, y es compatible con el Agent Client Protocol (ACP).

### 5. Los agentes se comunican a través del daemon

Los agentes nunca se conectan entre sí. Toda comunicación entre ellos, incluido el informe que recibe el constructor al empezar una ronda nueva, pasa por el daemon, que la registra como evento, aplica los gates y marca como no fiable lo que escribe un agente. Si en el futuro togi habla con agentes externos por A2A, lo hará el daemon, en su borde, nunca un agente desde su sandbox. Eso será una ampliación del ADR-005.

### 6. Credenciales del agente: dos modos

| | Clave de API | Suscripción |
| --- | --- | --- |
| Dónde se guarda | En el Llavero, como la clave maestra | La genera el usuario con el cliente oficial; togi nunca hace el inicio de sesión |
| Qué ve el agente | Solo un marcador | El token, porque el cliente oficial lo necesita |
| Protección | Fuera de su alcance, y red limitada | Solo red limitada |
| Cuándo se permite | Siempre. Es el modo por defecto | Solo en uso personal. Desactivado en el modo equipo |

Togi nunca extrae el token de suscripción para inyectarlo en la red ni lo sirve a otros clientes. Las condiciones de uso de cada proveedor se revisan al añadirlo.

### 7. Cada runtime declara lo que necesita

Cada adaptador de runtime (ADR-003) declara sus dominios, sus credenciales con los dominios donde se inyectan, sus rutas escribibles y si trae un sandbox propio y cómo se desactiva. Togi traduce esa declaración a la especificación del punto 1. El Claude Agent SDK es el primer adaptador; ACP es el candidato para un adaptador genérico cuando llegue un segundo proveedor.

### 8. La batería del experimento como tests de conformidad

Cada combinación de implementación de `Sandbox` y runtime pasa la batería en la CI, con sus controles positivos, y cada denegación se clasifica como bloqueada por el sandbox o inaccesible por diseño. Si una actualización reabre un acceso, la CI lo detecta antes de llegar a `main`.

## Resultados del experimento

| | `srt` | microsandbox |
| --- | --- | --- |
| Llavero, `~/.togi`, socket y puerto local | Bloqueados | Inaccesibles por diseño |
| Red y DNS | Bloqueados, salvo la API | Bloqueados, con las reglas del punto 3 |
| Variables de entorno del usuario | Bloqueadas | Bloqueadas |
| Clave de API con marcador, de punta a punta | Funciona | Funciona |
| Suscripción | Funciona | Funciona |
| Arranque | 80-130 ms | 390-570 ms |

El único destino que el agente intentó alcanzar fuera de la API fue la telemetría del cliente de Claude Code, y no es necesario para su funcionamiento.

## Alternativas descartadas

| Alternativa | Motivo |
| --- | --- |
| Docker Sandboxes | Producto cerrado; exige una cuenta de Docker incluso en local |
| NVIDIA OpenShell | Capa de políticas sobre Docker o Podman, pensada para flotas; demasiado pesada para un usuario |
| Apple `container` | Herramienta de línea de comandos, versión 0.x, solo macOS 26 |
| Sandboxes en la nube | El código sale del equipo del usuario |
| Sandbox del Agent SDK | Solo cubre los comandos de Bash, no las herramientas internas |
| `ora` | Deja abierto el acceso al Llavero |
| `ai-jail` | Licencia GPL-3 |
| Perfil de Seatbelt propio | Habría que mantenerlo; `srt` lo genera y lo mantiene |
| Usuario de macOS dedicado | Requiere permisos de administrador y no filtra la red |

Docker Sandboxes, OpenShell y Apple `container` se descartaron por sus características documentadas, sin probarlos.

## Riesgos y límites conocidos

- `srt` es una versión preliminar: su API y su configuración pueden cambiar. Se fija la versión y se aísla tras la interfaz.
- `sandbox-exec` está marcado como obsoleto por Apple, aunque sigue funcionando y lo usan Claude Code, Codex y Chromium.
- Con `srt`, las rutas fuera de la carpeta personal, como `/etc`, siguen siendo legibles, y el agente comparte el kernel con el usuario.
- `srt` solo se ha probado en macOS; su comportamiento en Linux, con bubblewrap, está sin probar.
- En modo suscripción, el token está al alcance del agente.
- Sin verificar: si un agente con sandbox propio, como Codex CLI en macOS, funciona dentro de `srt`. Probablemente haya que desactivar su sandbox, o usar microsandbox para él.
- microsandbox es beta, y el sistema de ficheros interno de la VM es escribible, aunque desechable y sin acceso al Mac.

## Disparadores de revisión

- Un runtime que no funcione dentro de `srt`.
- Un cambio incompatible en `srt`, o que deje de mantenerse.
- La llegada de la rebanada 3, en la que el agente ejecuta código.
- El trabajador remoto o el modo equipo, que pueden justificar un substrate de ejecución o la federación de identidades en lugar de claves fijas.

## Pendientes

- [ ] Probar Codex CLI, mediante su adaptador ACP, dentro de los dos sandboxes.
- [ ] Probar `srt` en Linux, para el trabajador remoto.
- [ ] Decidir si se desactiva la telemetría del cliente del agente o basta con bloquearla.
