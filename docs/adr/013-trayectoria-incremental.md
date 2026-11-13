# ADR-013: Trayectoria del agente incremental

13 de noviembre de 2026 · Arian

## Estado y contexto

**Estado:** propuesto el 13 de noviembre de 2026. El enfoque es el del plan de EVI-45 (hallazgo F-07 de la auditoría), que Arian aprobó ese día con riesgo alto. El ADR se aprueba al mergear su PR, antes que el código.

Hoy los eventos del agente solo llegan a togi cuando el agente ha terminado. Mientras trabaja, el daemon solo recibe heartbeats, y ni la CLI ni la app de escritorio pueden enseñar qué está haciendo.

Lo que dice el código:

- **El adaptador ya emite por línea:** `packages/worker/src/adapters/claude-agent-sdk/main.ts` escribe cada evento en el stdout según lo recibe del SDK.
- **El daemon ya escribe por línea:** `packages/daemon/src/worker/worker-launcher.ts` lee el stdout del trabajador con `readline` y añade cada `event` a `agent_events` según llega, en una cola de promesas sin tope.
- **El cuello está en medio:**
  - `SrtSandbox` acumula el stdout del agente (`stdout += d`) hasta que el proceso termina.
  - El puerto `Sandbox.run` de `core` (`packages/core/src/ports/sandbox.ts`) solo devuelve la salida entera al final.
  - El trabajador la parte en eventos después (`packages/worker/src/worker.ts`), y `stopReason` vuelve a recorrerla entera.
- **El protocolo no cambia:** `FromWorker` (`packages/core/src/ports/worker-protocol.ts`) ya es un mensaje JSON por línea. Lo que cambia es **cuándo** llegan los mensajes.
- **El endpoint ya sirve sesiones activas:** `GET /v1/tasks/:n/sessions/:id/trajectory` (`packages/daemon/src/http/plans.ts`) pagina con el cursor `after`.
- **Ningún cliente se entera a mitad de sesión:**
  - El escritorio (`TrajectoryPane.tsx`) relee la trayectoria solo cuando cambia la `version` de la tarea, y los eventos del agente no la cambian.
  - La CLI no tiene ningún comando que lea la trayectoria: `follow` solo consulta las sesiones y el plan.

Este ADR fija el diseño antes de construir, porque toca el puerto `Sandbox` de `core`, el trabajador y el sandbox, que son la frontera de seguridad del ADR-008.

Los criterios que tiene que cumplir (EVI-45):

1. La CLI y la app de escritorio muestran los eventos antes de que termine el agente.
2. El flujo aguanta consumidores lentos, mensajes malformados, cancelaciones y cierres inesperados.
3. `agent_events` se escribe de forma progresiva y `session.ended` mantiene su semántica.

## Decisiones

### 1. El puerto `Sandbox` acepta un callback por línea

`run` recibe un callback opcional `onLine(line: string) => void | Promise<void>`.

- **Con `onLine`:** el sandbox entrega cada línea completa del stdout según llega, sin el `\n`, y deja de acumularla. El `stdout` del resultado vuelve vacío.
- **Sin `onLine`:** todo sigue igual. La instalación del repo no lo pasa, porque su stdout no son eventos y el trabajador lo necesita entero para el diagnóstico.
- El stderr no cambia: se sigue acumulando, porque solo se usa su cola al fallar.

El cambio es aditivo: los llamadores y los dobles de test del puerto que no lo usan no se tocan.

### 2. Contrapresión de punta a punta

Un consumidor lento frena al agente, sin que crezca la memoria en ningún eslabón:

| Eslabón | Qué hace |
| --- | --- |
| Sandbox | Pausa `child.stdout` mientras la promesa de `onLine` está pendiente, y la reanuda al resolverse. El agente se bloquea al escribir cuando se llena la tubería. |
| Trabajador | `onLine` envía el evento con `output.write` y, si devuelve `false`, espera a `drain` antes de resolver. |
| Daemon | Pausa la lectura del stdout del trabajador cuando su cola pasa de 64 eventos pendientes, y la reanuda al bajar de esa cifra. Hoy la cola no tiene tope. |

Los heartbeats del trabajador siguen saliendo por su temporizador. Son pocos y pequeños, y el daemon hoy no vigila su ausencia, así que una pausa del daemon no mata la sesión.

### 3. Líneas malformadas

- Una línea que no es JSON o no cumple `FromWorker` se descarta, como hoy, en el trabajador y en el daemon.
- Una línea que pasa del tope de bytes por línea se descarta sin acumularla entera. El tope lo fija F-02 (EVI-41); por eso el código de este ADR espera a que F-02 esté mergeado.
- Un evento de otra sesión se descarta, como hoy.

### 4. Cancelación y cierre inesperado

- **Fragmento final sin `\n`:** no es un evento y se descarta, igual con éxito, fallo, tope de tiempo o cancelación.
- **Orden:** `run` no resuelve hasta que termina el último `onLine`. Así, todos los eventos salen del trabajador antes que su `result`, y el daemon los escribe antes de cerrar la sesión.
- **Cancelación o tope de tiempo:** el `onLine` que esté en curso termina; no se entrega ninguna línea más, y `run` resuelve como hoy.
- **Lo escrito, escrito está:** lo que ya está en `agent_events` se queda, aunque la sesión acabe mal. Es append-only (ADR-004).
- **El trabajador muere:** el daemon cierra la sesión con `worker_died`, como hoy. Con escritura incremental, la sesión cerrada a medias pasa a ser el caso normal, y el recuento de filas de EVI-40 cuadra al recuperar.

### 5. `stopReason` sale del flujo

El trabajador recuerda el último evento `usage` que envía y saca de él el motivo de parada. Ya no recorre el stdout entero al final, que con `onLine` ni siquiera existe.

### 6. `session.ended` no cambia

Se emite una sola vez, al final, con `trajectoryEvents` igual al número de filas escritas en `agent_events` para la sesión. Los eventos del agente no entran en el log de dominio, que el ADR-004 mantiene aparte de la trayectoria.

### 7. Los clientes consultan con su cursor

Mientras la sesión está activa, los clientes leen la trayectoria con el endpoint actual y su cursor `after`:

- **Escritorio:** `TrajectoryPane` relee cada segundo mientras el panel está abierto y la sesión está activa, y para cuando termina.
- **CLI:** `togi task follow` imprime los eventos nuevos en cada vuelta de su consulta, que ya es cada 400 ms.

No hace falta nada nuevo en el daemon.

## Alternativas descartadas

| Alternativa | Por qué se descarta |
| --- | --- |
| El puerto devuelve `{ lines: AsyncIterable, done }` | El iterador da la contrapresión de forma natural, pero cambia la firma del puerto, todos sus llamadores y todos sus dobles de test. El callback es aditivo. |
| Un SSE nuevo por sesión para avisar a los clientes | Menos latencia, pero suma un endpoint, su reconexión y una cola por cliente; la del SSE global ya no tiene tope. Con la consulta por cursor basta el endpoint de hoy. |
| Meter los eventos del agente en el log de dominio para que cambien la `version` | Rompe la separación del ADR-004: miles de eventos por sesión que no cambian el estado de la tarea. |
| Acumular en el sandbox y enviar por lotes cada N segundos | Sigue habiendo memoria sin tope en el sandbox y retraso; no resuelve la contrapresión. |

## Riesgos y límites conocidos

- **Frontera de seguridad:** el cambio toca el sandbox del ADR-008. El stdout sigue siendo dato no fiable: se valida con `FromWorker` y se limita por línea, igual que hoy pero antes.
- **Un consumidor atascado frena al agente:** es lo que se busca, pero si el daemon no avanza, el agente se queda bloqueado al escribir hasta que salta su tope de tiempo.
- **Carga de las consultas:** un cliente por sesión activa cada segundo (o cada 400 ms en la CLI). Con el tope de 3 sesiones del ADR-011 es poco; con el modo equipo puede justificar el SSE descartado.

## Construcción

Cuatro PRs, después de este y de F-02 (EVI-41), cada uno con sus tests:

1. **`core` y `worker`:** `onLine` en el puerto, `SrtSandbox` en streaming con pausa, el trabajador envía por línea con `drain` y `stopReason` sale del flujo.
2. **`daemon`:** cola acotada en `worker-launcher.ts`, con pausa y reanudación del stdout.
3. **`desktop`:** `TrajectoryPane` consulta mientras la sesión está activa y para al terminar.
4. **`cli`:** `togi task follow` imprime los eventos de la trayectoria según llegan.

## Disparadores de revisión

- El modo equipo o muchos clientes a la vez, que pueden justificar el SSE por sesión.
- El trabajador remoto (ADR-008 §4), si la tubería deja de ser local.
- Un runtime cuyo adaptador no emita por línea.
