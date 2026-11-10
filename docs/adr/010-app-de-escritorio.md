# ADR-010: App de escritorio

7 de noviembre de 2026 · Arian

## Estado y contexto

**Estado:** aprobado el 7 de noviembre de 2026. Propuesto y revisado ese mismo día; la revisión añade la sección 8 (seguridad del contenido de los agentes), construye la fase 1 ahora en lugar del PR U7 (`togi inbox`) y resuelve la pregunta 1 sobre el navegador de los gates.

**Enmienda del 9 de noviembre de 2026:** la barra lateral pasa de una lista plana de tareas a una **columna de proyectos** (alternativa B de la página «Fase 1» del lienzo). Cambian el §2 y la fila «Lista de tareas» del §3; el resto del ADR no cambia.

**Enmienda del 10 de noviembre de 2026:** la **mesa en vivo** pasa de la fase 3 a la fase 1. togi es una factoría visual con togi como intermediario, y la mesa es la forma de ver cómo fluye la información y en qué estado está cada agente mientras se construyen el constructor, los gates y el revisor. Nace con lo que ya existe (tú, togi y las sesiones del planificador) y cada rol nuevo aparece en ella cuando existe en el backend. Para verlo antes que el agente real se usan los agentes falsos de los tests sobre el daemon real, en una demo local, nunca en la app distribuida ni con datos inventados en el webview. Cambian el §3 (la mesa), la tabla de la API y la de fases; el resto del ADR no cambia. El diseño de la pantalla 5 del lienzo es la referencia, no una especificación cerrada. El atajo de la mesa pasa de ⌘M a **⌘2**, y las tareas quedan en ⌘1: ⌘M es «Minimizar» en macOS, un atajo estándar que no se reutiliza.

El principio 3 hace del daemon el núcleo y de la CLI, la web UI y la app de escritorio sus clientes. Este ADR define la app de escritorio: qué muestra, cómo se conecta al daemon y qué no puede hacer. El diseño de referencia son las siete pantallas del [lienzo de la app de escritorio](https://claude.ai/artifact/QCo31vuqqDekePy6dNWcmM) y la identidad visual, el [manual de marca](../marca/manual-de-marca.md).

Las referencias de uso son Conductor, Paseo, T3 Code y Herdr. De ellas se toman patrones comunes del género (lista de trabajos con su estado de atención, paneles divididos, diff, terminal, explorador de ficheros y uso intensivo del teclado), nunca su maquetación exacta ni su identidad visual.

Debe cumplir:

- La app habla solo con la API del daemon, como la CLI (requisito nº 2 del modo equipo).
- El token del daemon no puede llegar a ningún contenido que la app renderice ni a ningún proceso que lance (ADR-005).
- Nada de lo que la app añade puede abrir una vía para que un agente salga de su sandbox (ADR-008).
- Los agentes no se hablan entre sí; todo pasa por togi (ADR-009). La app lo muestra, no lo esconde.
- No adelanta controles (principio 1): la fase 1 solo consume APIs que ya existen o están planificadas.

## Decisión

### 1. Un cliente más, sin lógica propia

- Tauri 2, Vite, React y TypeScript en `packages/desktop`, con versiones exactas y la regla de las dos semanas. El frontend importa tipos y el mapa de estados de `@togi/core`; nunca `@togi/daemon`.
- El lado Rust habla con el daemon por el socket Unix del ADR-005 y expone comandos al webview. **El token se queda en el lado Rust.** Los eventos SSE se reenvían al webview como eventos de Tauri.
- El webview solo carga el propio bundle de la app: sin URLs remotas, CSP estricta y las capacidades de Tauri limitadas a los comandos que la app define.
- La app no guarda estado del dominio. Si el daemon no responde, lo dice y no muestra datos viejos como si fueran actuales.

### 2. Dos densidades

- **Banco de taller**, para trabajar: columna lateral de proyectos (un proyecto es un repo con tareas), cada uno con sus tareas agrupadas por quién tiene que actuar; la columna se pliega a un riel con la inicial de cada proyecto y su ◆ (⌘\). Tres vistas: «Pendiente de ti» (lo que espera tu decisión en todos los proyectos), el resumen de un proyecto y el cuaderno de una tarea. La tarea seleccionada con pestañas y paneles divisibles (⌘D, ⌘⇧D, como máximo dos), barra de estado y paleta de comandos (⌘K) con los mismos verbos que la CLI.
- **Cuaderno**, para decidir: una tarea en `plan_review` o `review` se abre en la vista de lectura de la web, con un único botón principal.

### 3. Vistas

| Vista | Qué muestra | Pantalla |
| --- | --- | --- |
| Columna de proyectos | Los proyectos (repos con tareas) y, en cada uno, sus tareas: te esperan, en marcha y el resto, con glifo, id, título y nota de estado. Los contadores son parciales si la lista llega truncada | todas |
| Trayectoria | Las acciones de la sesión activa en orden: leer, razonar, editar, ejecutar y las denegadas por los hooks | 1 |
| Plan | La versión aprobada y el historial con los motivos de cada cambio | 2 (cuaderno) |
| Diff | El cambio frente a la base, con los ficheros marcados dentro o fuera del plan | 3 |
| Log | Los eventos de la tarea en crudo | — |
| Ficheros | El árbol de la rama de la tarea con su estado en git y en el plan, y un visor de solo lectura | 6 |
| Navegador | Lo que renderiza el navegador de los gates, con sus acciones, consola, red y capturas | 7 |
| Mesa en vivo (⌘2) | El mapa de las sesiones activas alrededor de togi y los mensajes entre ellas y togi | 5 |
| Terminales (⌘T) | Las terminales del usuario y la salida de las sesiones de agente | 4 |

La mesa se dibuja con lo que ya registra el log: cada evento tiene un actor y un stream, y todo evento pasa por togi (ADR-009). Una arista es siempre actor ↔ togi, así que no hace falta añadir un campo de destinatario al esquema de eventos. La vista de secuencia queda como alternativa dentro de la mesa.

La mesa es viva: se mueve sola, sin recargar. Los mensajes recorren su arista al ocurrir, los nodos cambian de estado (ciclo, progreso de un gate), las sesiones aparecen al empezar y se apagan al terminar, y una acción denegada destaca en su arista. Para eso el lado Rust reenvía, de cada evento del log y de la trayectoria, solo su cabecera (`seq`, `at`, actor, tipo y stream), nunca su contenido; el contenido se lee aparte, con un comando concreto, cuando se elige el evento. La mesa también muestra lo que togi entrega a cada agente, no solo lo que los agentes le mandan: así se ve que ningún agente recibe el razonamiento de otro (política de entradas por rol, que fijará el ADR-011, en preparación).

En la interfaz, los roles se muestran con los nombres del ADR-009. En el código se usan los identificadores del ADR-004.

### 4. Terminales

- **Las del usuario** son pseudoterminales locales: una PTY en el lado Rust y xterm.js en el webview. Se lanzan con un entorno en lista blanca, sin el token, sin variables `TOGI_*` y sin las credenciales de los agentes.
- **Se abren en un checkout del usuario**, nunca en el directorio del sandbox, que es desechable y se exporta con `git archive` (ADR-008). Para una tarea, la app ofrece abrir la terminal en un checkout aparte de su rama.
- **La de un agente es una vista de eventos, no una TTY.** Los agentes trabajan con el Agent SDK. La app muestra la salida de sus herramientas tal como la registra togi, y es de solo lectura.

### 5. Ficheros

El explorador muestra la rama de la tarea en su último commit, más los cambios en curso que llegan por los eventos de la sesión. En esta versión es **de solo lectura en todos los casos**. Para editar, "Abrir en el editor" lleva al checkout del usuario.

### 6. Navegador

El diseño de la pantalla 7 mostraba al constructor manejando un navegador durante `building`. Eso choca con el ADR-008: el sandbox del agente no permite sockets Unix, puertos locales ni `allowLocalBinding`, así que el agente no puede levantar un servidor de desarrollo al que llegue un navegador de fuera.

Decisión para la primera versión:

- **El navegador pertenece a los gates**, con actor `system: gates`, y se usa en `verifying`. El ejecutor de gates levanta la aplicación y un Chromium headless **dentro de un aislamiento propio que permita el loopback interno** (previsto: microsandbox, ADR-008 §3), sin acceso a internet. `srt` no sirve: sin `allowLocalBinding` (ADR-008 §2), un servidor y un navegador no se pueden hablar.
- Las capturas y las acciones se guardan como blobs y eventos. La app las muestra, en directo si el daemon reenvía los frames.
- **Solo lectura.** "Tomar el control" sale de esta versión: una persona interactuando con el navegador de un gate rompería la reproducibilidad de la verificación.
- Las capturas son evidencia para la revisión, no un gate. La comparación visual automática se decidirá aparte (principio 5).

Que el constructor use el navegador durante `building` exige revisar el ADR-008 y queda fuera de este ADR.

### 7. Marca

La app sigue el manual de marca: los tokens del sistema de diseño en los dos temas, solo Shippori Mincho, Zen Kaku Gothic New y M PLUS 1 Code, empaquetadas en la app y nunca cargadas de Google Fonts, y la tabla de estados como única fuente de glifos y colores. Densidad de escritorio: texto a 13 / 20 px, mono a 12,5 / 20 px y filas de 32 px.

### 8. Seguridad del contenido de los agentes

Todo lo que escribe un agente (plan, trayectoria, log, salida de herramientas, diff) es entrada no fiable. Complementa la CSP y las capacidades limitadas de la sección 1:

- **Nunca se pinta como HTML.** Solo texto o markdown con un renderizador de versión fijada que no admita HTML crudo. Sin `dangerouslySetInnerHTML`.
- **La CSP prohíbe scripts en línea y `eval`:** ni `unsafe-inline` ni `unsafe-eval` en `script-src`.
- **Los comandos de Tauri son concretos, uno por acción.** Nunca un reenvío genérico (método y ruta) a la API del daemon, para que el webview no pueda emitir peticiones arbitrarias. El token no cruza al webview (ADR-005).

## Lo que necesita de la API

Propuesta; cada endpoint se precisa en el ADR de la API de la rebanada que lo construya.

| Endpoint | Para | Notas |
| --- | --- | --- |
| `GET /tasks/:id/diff` | Diff | Contra el `baseSha` del plan |
| `GET /tasks/:id/files?ref=` y `GET /tasks/:id/files/{path}` | Ficheros | Solo lectura, rama de la tarea |
| `GET /v1/tasks/:n/sessions/:id/trajectory` | Trayectoria | Nueva; hoy no existe ninguna ruta de lectura. Sigue el patrón de `GET /v1/tasks/:n/sessions` |
| `GET /sessions?state=active` | Mesa | Nueva; hoy las sesiones solo se listan por tarea |
| `GET /tasks/:id/evidence` | Cuaderno de revisión | Gates, trayectoria resumida y revisor en sombra en una sola respuesta |
| `GET /tasks/:id/browser` (SSE) | Navegador | Frames y acciones del navegador de los gates |
| `GET /events` (SSE) | Todo lo que va en directo | Ya existe (ADR-005) |

## Alternativas descartadas

| Alternativa | Por qué se descarta |
| --- | --- |
| Electron | Más peso para lo mismo; Tauri ya estaba elegido en el contexto del proyecto |
| Una app con estado o lógica propia | Contradice el principio 3 y duplicaría las reglas del flujo |
| Una caja para hablar con el agente durante `building` | El alcance lo fija el plan aprobado (ADR-001). Para cambiarlo, se detiene la tarea y se vuelve a planificar |
| Terminal del usuario dentro del sandbox del agente | Contaminaría el diff y el sandbox, y rompería su condición de desechable (ADR-008) |
| Navegador del agente fuera del sandbox | Abriría puertos locales y red, justo lo que impide el ADR-008 |
| Mesa como diagrama de secuencia por defecto | El mapa responde mejor a "qué está pasando ahora"; la secuencia queda como segunda vista |
| Copiar el estilo de alguna referencia | togi tiene su propia identidad (manual de marca) |

## Consecuencias y cuándo se construye

La fase 1 se construye ahora, en lugar del PR U7 de `docs/plan-rebanada-2.md` (`togi inbox`): la lista de tareas de la app hace ese papel. Las fases 2 a 4 se construyen después, con su propio plan:

| Fase | Qué entra | Requiere |
| --- | --- | --- |
| 1 | Shell, lista de tareas, plan, cuaderno del gate 1, trayectoria y mesa en vivo (enmienda del 10 de noviembre) | `GET /v1/tasks`, `GET /v1/events`, la API de planes (PR 4), la escritura de la trayectoria (PR 12), la ruta de lectura de la trayectoria, la cabecera de cada evento reenviada por Rust y `GET /sessions?state=active` |
| 2 | Diff, log, cuaderno del gate 2 y terminales | Rebanada 4 |
| 3 | Ficheros | Endpoints de ficheros |
| 4 | Navegador | Gate visual y el aislamiento con loopback interno (sección 6) |

Riesgos:

- **La PTY da una shell con los permisos del usuario** dentro de un proceso que también habla con el daemon. Mitigación: entorno en lista blanca, el token solo en el lado Rust y un webview que no carga contenido remoto.
- **Las fuentes japonesas pesan.** Mitigación: subconjuntos de caracteres en el empaquetado.

Decidido en la revisión:

- El navegador de los gates no puede ir en `srt`: no permite loopback entre servidor y navegador sin abrir puertos locales (ADR-008 §2). Necesita otro aislamiento; el previsto es microsandbox (ADR-008 §3), sujeto a su evaluación en la rebanada 3.

Pendiente de decidir:

1. Qué evento registra un commit humano en la rama de una tarea en `review`, y si `plan_contract` se le aplica. Propuesta: se registra, no se le aplica el contrato y se repiten los gates.
2. Qué crate de PTY se usa en el lado Rust, con versión fijada.
3. El tema por defecto de la app (decisión abierta del manual de marca).
