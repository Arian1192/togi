# ADR-011: Construcción y verificación (rebanada 3)

10 de noviembre de 2026 · Arian

## Estado y contexto

**Estado:** aprobado el 10 de noviembre de 2026. Arian elige la recomendación de cada punto y fija el esfuerzo del builder (punto 8). Quedan dos cosas antes de construir lo que dependen de ellas: los valores del perfil de `promos` (punto 5) y la prueba de `promos` dentro de `srt` (punto 2).

Hoy togi llega hasta el gate 1: al aprobar el plan, la tarea pasa a `building` y ahí se queda. No hay builder, ni copia escribible del repo, ni gates, ni salida a `verifying`, `review` o `failed`. Este ADR fija cómo se construye y se verifica, con lo que ya está decidido en otros:

- **ADR-001:** el plan es un contrato; los tests existentes no se tocan; como máximo 3 ciclos `building` → `verifying`; el agente no se autoevalúa y la verificación la repite togi en un entorno que el agente no controla. El ADR-001 sigue «propuesto» y este depende de él (decisión 0).
- **ADR-003:** el builder tiene `Read`, `Glob`, `Grep`, `Edit`, `Write` y `Bash` limitado a los comandos del perfil del repo; el hook de togi bloquea los tests existentes, la configuración de gates, `.github/`, las credenciales y los ficheros fuera del plan.
- **ADR-004:** los eventos `workspace.created`, `build.submitted`, `gate.completed`, `verification.completed`, `task.failed`, `failure.classified` y `task.risk_changed`, y las proyecciones `workspaces`, `gate_runs` y `unclassified_failures`.
- **ADR-008:** la copia del repo nunca con `git worktree` (un checkout ejecuta hooks del repo en el daemon); microsandbox a evaluar en esta rebanada; la llegada de la rebanada 3 es un disparador de revisión.

Queda abierto, y lo decide este ADR: ejecución en paralelo, sandbox del builder y de los gates, tipo de copia de trabajo, dependencias del repo, perfil del repo, el Bash del builder, el límite de tamaño de las tareas, el builder por defecto y los gates de esta rebanada.

## Decisiones

### 0. El ADR-001 se aprueba antes que este
Este ADR construye los estados `building`, `verifying`, `review` y `failed` tal como los define el ADR-001. **Recomendación:** aprobar el ADR-001 tal cual, salvo el punto de la integración de `dev` y la merge queue, que pasa a la rebanada 4.

### 1. Varias tareas a la vez
Hoy el orquestador planifica de una tarea en una (`orchestrator.ts:56`).

| Opción | A favor | En contra |
| --- | --- | --- |
| A. Todo en serie, como ahora | Simple; el coste por hora está acotado | Una tarea larga bloquea las demás; la mesa nunca está llena |
| **B. En paralelo con un tope global (por defecto 3 sesiones)** | Varias tareas avanzan a la vez; el tope acota coste y CPU | Hay que repartir el tope entre roles y vigilar el gasto |
| C. Sin tope | Lo más rápido | Gasto y carga sin control |

**Recomendación: B.** Un tope global de sesiones de agente (`maxConcurrentSessions: 3`, configurable), como mucho una sesión por tarea, y los gates fuera del tope porque no gastan modelo. Los merges siguen en serie (ADR-001), así que el paralelo no toca la rama base.

### 2. Sandbox del builder y de los gates
En esta rebanada el agente ejecuta código del repo (tests, lint), y los gates también.

| Opción | A favor | En contra |
| --- | --- | --- |
| **A. `srt` para los dos** | Pasó la batería del ADR-008; mismo sistema que el usuario, así que las dependencias nativas de macOS funcionan; 80-130 ms de arranque | El límite es un proceso, no una máquina virtual |
| B. microsandbox para los dos | Límite de máquina virtual: el mejor aislamiento para código no fiable | Beta; Linux dentro de la VM, así que hay que instalar dependencias para Linux y el entorno ya no es el del usuario; 390-570 ms |
| C. `srt` para el builder y microsandbox para los gates | Los gates, que son la verificación que cuenta, corren con más aislamiento | Dos entornos distintos: un test puede pasar en uno y fallar en el otro |

**Recomendación: A** para la rebanada 3, con las mismas reglas obligatorias del ADR-008 (la carpeta personal, `/Users`, `/Volumes`, `/tmp` y las temporales denegadas; sin sockets ni puertos locales; red solo por lista blanca). microsandbox se evalúa cuando llegue el gate del navegador, que no corre en `srt` (ADR-010). La batería de conformidad se amplía con los casos del builder (punto 9).

**Condicionada a una prueba previa**, que es el primer paso de la construcción: ejecutar la instalación, el typecheck, el lint y los tests reales de `promos` dentro de `srt` con esas reglas. Si los tests de la API necesitan abrir un puerto local o llegar a una base de datos, `srt` no los deja, y habrá que decidir entre permitir el loopback solo a los gates, una base de datos en memoria o microsandbox. Si la prueba falla, este punto vuelve a Arian antes de seguir.

**Resultado de la prueba (10 de noviembre de 2026), aprobado por Arian.** Clon de `promos` (rama `dev`) con el directorio de git aparte y las reglas del ADR-008:

| Paso | Dentro de `srt` |
| --- | --- |
| Typecheck | Pasa (6 s). |
| Tests | 2680 de 2688 pasan. Fallan los 8 de `apps/api/src/server.test.ts`, que arrancan el servidor HTTP de verdad: `listen` da `EPERM`. Los de la API usan PGlite en el proceso, sin Postgres. |
| Instalación | Falla: pnpm 12 escribe su bloqueo siempre en `/private/tmp/pnpm-store-operation-locks-<uid>`, sin hacer caso a `TMPDIR`, y `/tmp` está denegado. Descargar fuera sin scripts y ejecutarlos dentro (`pnpm rebuild`) choca con el mismo bloqueo. |

Dos hallazgos más:

- **togi no hacía llegar `TMPDIR` al sandbox.** srt lo sustituye por el `CLAUDE_CODE_TMPDIR` de quien lo lanza (o `/tmp/claude`). Se arregla en el worker y afecta también al planificador.
- **`allowLocalBinding` de srt no sirve.** Además de dejar escuchar, deja conectarse a todo lo que escucha en el loopback del Mac: en la prueba llegó al Postgres de desarrollo de `promos` (5432) y a otros servicios. Queda prohibido, como `allowAll` en microsandbox.

Con eso, dos excepciones acotadas:

1. **La instalación**, que es una ejecución sin agente, puede escribir **solo** en `/private/tmp/pnpm-store-operation-locks-<uid>`. El builder y los gates siguen sin `/tmp`. Lo peor que puede hacer un script de instalación ahí es estropear los bloqueos de pnpm del usuario, y se arregla repitiendo la instalación.
2. **Los tests que necesitan abrir un puerto** salen del gate `test` de togi con un campo del perfil (`testExclude`); en `promos`, `apps/api/src/server.test.ts`. La CI del repo los sigue ejecutando antes del merge. Vuelven al gate cuando llegue microsandbox, que tiene su propio loopback dentro de la VM.

### 3. La copia de trabajo: un clon de togi, con git fuera del árbol
El ADR-004 dice `Workspace.kind: "worktree"`, pero el ADR-008 descarta `git worktree` porque el checkout ejecutaría los hooks del repo en el daemon, fuera del sandbox.

**Recomendación:** cada tarea tiene un **clon local propio de togi**, con el árbol de trabajo en `~/.togi/workspaces/<id>/tree` y **el directorio de git fuera de él**, en `~/.togi/workspaces/<id>/git`:

- `git clone --local --no-checkout --separate-git-dir` del repo registrado y checkout de la rama base. El sandbox ve el árbol, nunca el directorio de git: ni el builder ni el código del repo que se ejecuta en el sandbox (la instalación y los tests) pueden escribir un `.git/config` con `core.fsmonitor`, `diff.external` o hooks que luego ejecutaría el daemon.
- Todo `git` que ejecuta togi lleva `--git-dir` y `--work-tree` explícitos, sin fiarse del fichero `.git` del árbol, que el código del repo podría reescribir para apuntar a otro sitio. Va también sin la configuración del usuario ni la del sistema (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`) y con `core.hooksPath=/dev/null`. El clon no hereda hooks ni filtros del repo original, así que un `.gitattributes` que pida un filtro no ejecuta nada.
- El commit lo hace el daemon al terminar la sesión, con el trailer `Assisted-by: <runtime>/<modelo>`, en la rama `togi/<número>-<slug>`.
- `Workspace.kind` pasa a `"clone"` (ver «Qué enmienda»). `workspace.released` borra el clon al llegar a un estado final.

La alternativa es un `git worktree` con los hooks desactivados; se descarta abajo.

### 4. Las dependencias del repo

El builder y los gates necesitan `node_modules`, y los scripts de instalación son código del repo.

**Decisión:** togi instala las dependencias **dentro del sandbox**, en una ejecución propia, sin agente, antes de la primera sesión de `building`, con el comando del perfil (punto 5) y la red abierta solo a los dominios exactos del registro (`registry.npmjs.org` para `promos`). El agente nunca tiene esa red.

Los manifiestos y el lockfile están protegidos por defecto (punto 5), así que el builder no puede cambiar las dependencias y no hay que reinstalar entre ciclos. Una tarea que necesite una dependencia nueva lo dice en su plan y la añade el humano: añadir dependencias es una decisión humana. Si el builder lo intenta, `protected_paths` falla.

Los gates **no usan esa instalación**: cada `verifying` hace la suya en su propio clon (punto 9), así que nada de lo que el builder escriba en `node_modules` llega a la verificación.

### 5. El perfil del repo vive en togi

Los comandos y las rutas protegidas de cada repo. Viven en togi, no en el repo objetivo (principio 4), versionados como evento (`repo.profile_set`) y visibles en la app:

```ts
interface RepoProfile {
  install: string;            // "pnpm install --frozen-lockfile"
  checks: { typecheck: string; lint: string; test: string };
  testFiles: string[];        // globs de tests, para test_integrity y para medir el diff
  protectedPaths: string[];   // configuración de gates, .github/, credenciales: el builder nunca los toca
  docs: string[];             // globs de documentación, para medir el diff
  registry: string[];         // dominios exactos para instalar
  testExclude: string[];      // tests que el sandbox no puede ejecutar (abren puertos); los corre la CI del repo
}
```

`togi repo profile` propone valores leyendo `package.json` y los scripts de la CI; el humano los confirma.

**`protectedPaths` lleva siempre unos mínimos que el perfil no puede quitar**, porque son lo que el agente usaría para trucar la verificación: `package.json` de cualquier carpeta, los lockfiles, la configuración de las herramientas de los gates (`tsconfig*.json`, la de lint y la del runner de tests), `.github/` y cualquier fichero que se parezca a una credencial (`.env*`, `*.pem`, `*.key`). Sin eso, el builder podría cambiar `"test"` por `exit 0`. El perfil solo añade rutas.

**Perfil de `promos`, primera versión** (sacado del repo y aprobado por Arian el 10 de noviembre):

| Campo | Valor |
| --- | --- |
| `install` | `pnpm install --frozen-lockfile` |
| `checks` | `typecheck`: `pnpm typecheck`; `lint`: ninguno (`promos` no tiene); `test`: `pnpm test` |
| `testFiles` | `apps/**/*.test.{ts,tsx}`, `apps/web/e2e/**` |
| `protectedPaths`, además de los mínimos | `apps/*/src/test/**`, `apps/api/drizzle/**`, `**/vitest.config.ts`, `**/playwright.config.ts`, `apps/api/drizzle.config.ts`, `bruno/**/.env*`, `package-lock.json` |
| `docs` | `docs/**`, `**/*.md` |
| `registry` | `registry.npmjs.org` |
| `testExclude` | `apps/api/src/server.test.ts` |

Los e2e de Playwright no entran en los gates de esta rebanada: necesitan navegador, que va con microsandbox (ADR-010). Los `.env` con credenciales de `promos` no están en git, así que no llegan al clon.

### 6. El Bash del builder: comandos exactos
**Recomendación:** la herramienta `Bash` del builder solo acepta los comandos de `checks` del perfil, tal cual o con rutas del repo como argumentos (`pnpm test apps/api/src/promos`). El hook rechaza cualquier otra cosa, y también cualquier metacarácter de shell (`;`, `&&`, `|`, `$(`, redirecciones), para que un comando permitido no sirva de puerta a otro.

El hook limita la herramienta, no el código: el builder puede escribir un test que ejecute lo que quiera, y ese test corre al lanzar `pnpm test`. Por eso **lo que de verdad impide instalar, usar `git`, salir a la red o leer credenciales es el sandbox**, no el hook: el directorio de git y la red quedan fuera de su alcance (puntos 2 y 3). La prueba de ataque lo comprueba desde dentro de un fichero de test (punto 9).

### 7. El límite de tamaño de las tareas: el mismo que en este repo
**Recomendación:** el gate `diff_size` mide el diff real como `tools/diff-size.mjs`: **200 líneas de producción y 500 en total**, sin contar el lockfile, y clasificando con `testFiles` y `docs` del perfil. Sin margen del 10% para el agente: el margen es un juicio que aquí hace el humano en el gate 1. Es el mismo límite que el gate 1 ya aplica al plan (ADR-007, nota de la rebanada 2).

### 8. El builder por defecto

**Decidido por Arian (10 de noviembre):** `generic-builder@1`, en el runtime `claude-agent-sdk`, con el mismo modelo que el planificador (`claude-sonnet-5-5`), **esfuerzo de razonamiento `medium`** y las herramientas del ADR-003. Codex sigue como segundo runtime para más adelante. El especialista se elige como el del planificador y se muestra en `plan_review`.

El esfuerzo es la opción `effort` del Agent SDK (`low`, `medium`, `high`, `xhigh`, `max`). En `claude-sonnet-5-5` el razonamiento está siempre activo y su esfuerzo por defecto es `high`, así que `medium` se fija explícitamente. El esfuerzo pasa a ser un campo del especialista, como el modelo: cambiarlo es una versión nueva (`generic-builder@2`), nunca una edición. El planificador sigue con el esfuerzo por defecto del modelo hasta que se decida otra cosa.

### 9. Los gates de la rebanada 3: capas 1 y 2

Corren en `verifying`, en una ejecución propia de togi, sin sesión de agente, sobre **un clon nuevo del commit del builder** con su propia instalación (punto 4): nada de lo que el builder dejó en su árbol fuera del commit, ni en `node_modules`, llega a la verificación. La instalación tiene la red del registro; los gates, ninguna.

**Se ejecutan todos y se informan todos los fallos del ciclo.** Si se parara en el primero, un fallo de lint, otro de tipos y otro de tests gastarían los tres ciclos sin que el builder viera nunca el problema entero. Solo se salta lo que no tiene sentido: si falla la instalación, no hay typecheck, lint ni tests.

| Gate | Qué comprueba |
| --- | --- |
| `plan_contract` | El diff solo toca ficheros del plan aprobado. |
| `test_integrity` | Ningún test existente se modifica, se borra ni se marca `skip`/`only`. |
| `protected_paths` | Nada de `protectedPaths` cambia. |
| `diff_size` | El límite del punto 7. |
| `typecheck`, `lint`, `test` | Los comandos del perfil, con su salida como evidencia. |

Cada gate escribe un `gate.completed` con su evidencia; al terminar, `verification.completed`. Si falla y quedan ciclos, la tarea vuelve a `building` con el informe de los gates, marcado como no fiable (ADR-008 §5); al tercer fallo, `task.failed`, y el humano lo clasifica (`failure.classified`). Con todo en verde, se recalcula el riesgo según los ficheros tocados (`task.risk_changed`) y la tarea pasa a `review`. El PR y el merge son la rebanada 4.

Como en la rebanada 2, la rebanada 3 se cierra con una **prueba de ataque**. Un builder falso intenta, con sus herramientas y desde dentro de un fichero de test que luego ejecuta:

- tocar un test existente o `package.json`;
- leer credenciales;
- salir por la red;
- escribir en el directorio de git o reescribir el fichero `.git` del árbol;
- dejar algo en `node_modules` que cambie el resultado de los gates;
- aprobar su propio plan.

Todo debe fallar o no llegar a la verificación.

## Qué enmienda este ADR

Aprobado, enmienda los ADR siguientes, que lo dicen en su estado:

- **ADR-004:** `Workspace.kind` pasa de `"worktree"` a `"clone"`, con el directorio de git separado del árbol.
- **ADR-008 §1:** además de la copia de solo lectura, una copia escribible por tarea (el árbol del clon), y el directorio desechable deja de ser el único escribible para el builder. La red admite, solo en la instalación, los dominios exactos del registro del perfil, y la instalación puede escribir en `/private/tmp/pnpm-store-operation-locks-<uid>` (punto 2). `allowLocalBinding` queda prohibido en `srt`, porque abre todo el loopback del Mac.
- **ADR-003:** el Bash del builder queda definido por el punto 6, y su bloqueo de ficheros incluye los `protectedPaths` del punto 5.
- **ADR-001:** la integración de `dev` y la merge queue pasan a la rebanada 4 (decisión 0).

## Orden de construcción

0. La prueba de `promos` dentro de `srt` (punto 2), antes de escribir nada.
1. Núcleo: eventos y comandos de la rebanada 3 en el decider, y el contador de ciclos.
2. Perfil del repo: evento, proyección, API y `togi repo profile`.
3. Copia de trabajo (punto 3) e instalación de dependencias (punto 4).
4. Sesión de `building`: el builder, sus hooks, el commit con el trailer y el orquestador con el tope del punto 1.
5. Gates (punto 9), sus eventos y proyecciones, y la API para clasificar fallos.
6. Riesgo recalculado y prueba de ataque.

Cada paso en PRs del tamaño del ADR-007. La mesa y el lateral ya muestran el builder y los gates en cuanto existen (ADR-010).

## Alternativas descartadas

| Alternativa | Por qué se descarta |
| --- | --- |
| `git worktree` con los hooks desactivados | Los filtros y la configuración del repo del usuario siguen aplicándose en el checkout, en el daemon; el clon propio no hereda nada. |
| Copia con `git archive` y repo nuevo | Pierde la historia: no se puede integrar `dev` ni abrir el PR sobre la rama base sin rehacer el commit. |
| Instalar dependencias fuera del sandbox | Los scripts de instalación son código del repo y se ejecutarían con los permisos del usuario. |
| Dar al builder red al registro | Le abriría una vía de exfiltración en toda la sesión; instalar es un paso aparte. |
| Dejar que el builder haga sus commits | Podría reescribir la historia o tocar `.git`; el commit lo hace togi con su configuración. |

## Riesgos y límites conocidos

- `srt` es un límite de proceso. Ejecutar tests de un repo no fiable con él es aceptable para `promos`, que es tuyo; para repos de terceros, el disparador de revisión es microsandbox.
- Con 3 sesiones a la vez, el gasto por hora se triplica; el tope y el presupuesto por sesión (`maxCostUsd`) lo acotan.
- El clon local duplica los objetos del repo; para `promos` es poco, para repos grandes habrá que usar `--shared` o un caché.
