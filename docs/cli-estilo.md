# Guía de estilo de la CLI de togi

3 de noviembre de 2026 · Arian

## Personalidad y principios

La CLI de togi es sobria y precisa, como el oficio que le da nombre: dice lo justo, muestra el estado real y nunca adorna. Es una propuesta de estilo; los nombres de comandos y flags ya los fija el ADR-005.

1. **Las decisiones primero.** Lo que espera una decisión tuya (un plan, un PR, un fallo) aparece arriba y señalado; lo que trabaja solo, abajo y en gris.
2. **Silencio cuando todo va bien, detalle cuando no.** Un comando que funciona dice en una línea qué hizo; un error dice qué pasó, por qué y qué hacer.
3. **Nada se adivina.** La CLI nunca elige por ti en una operación con consecuencias: rechazar pide confirmación en una terminal interactiva.
4. **Igual de útil para scripts.** Todo lo que se ve tiene su versión `--json`, con un formato estable.
5. **La CLI es un cliente más.** Solo habla con la API del daemon; nunca abre la base de datos ni toca git (ADR-005).

## Gramática de comandos e idioma

Los comandos siguen `togi <recurso> <verbo> [argumento] [flags]`, como `gh` o `kubectl`, y solo los dos que más se usan van sin recurso.

| Forma | Ejemplos |
| --- | --- |
| `togi <recurso> <verbo>` | `togi task new`, `togi task submit 12`, `togi daemon start`, `togi admin verify-log` |
| `togi <verbo>` (atajos frecuentes) | `togi status`, `togi watch` |

- **Una tarea se nombra por su número:** `togi task show 12`. En la salida aparece como `#12`.
- **Flags largos siempre, cortos solo para los habituales:** `--risk`/`-r`, `--json`, `--yes`/`-y`, `--help`/`-h`.
- **El texto largo nunca va en un flag obligatorio:** sin `--description`, se abre `$EDITOR`.
- **Idioma:** comandos y flags en inglés, como fija el ADR-005; mensajes en español en la rebanada 1, todos en un catálogo único para poder traducirlos después.

## Salida para personas

Cada comando cabe en 80 columnas, usa tablas alineadas sin bordes y muestra el número de tarea, el estado y la fecha relativa. Los ejemplos son orientativos; los textos exactos se fijan en el catálogo de mensajes.

**`togi status`**: lo que espera una decisión arriba, el resto debajo.

```
Pendiente de ti
  #15  Migración de perfiles        draft      alto   falta criterio

En curso
  #12  Filtro por fecha en envíos   planning   bajo   hace 2 h
  #13  Paginación de pedidos        planning   medio  hace 1 d

3 tareas · 2 rechazadas ocultas (togi status --all)
```

**Cerradas.** Las tareas `merged` y `rejected` no salen por defecto: la línea final las cuenta como ocultas. El grupo «Cerradas» aparece, después de «En curso», solo con `--all` o con `--state merged` / `--state rejected`; en esos casos ya no hay línea de ocultas.

```
$ togi status --all
En curso
  #12  Filtro por fecha en envíos  planning  bajo   hace 2 h

Cerradas
  #9   Exportar a PDF              rejected  medio  hace 3 d
  #10  Login con enlace mágico     merged    alto   hace 1 d

3 tareas
```

Si la API devuelve 200 tareas (el máximo por petición), la línea final avisa de que solo se muestran las primeras 200 y no presenta el recuento como total.

**`togi task new`**: una línea con el resultado y el siguiente paso.

```
✓ Creada #16 «Exportar CSV» (riesgo bajo, draft)
  Falta el criterio de aceptación: togi task edit 16
```

**`togi task show 12`**: cabecera con el estado, después los textos.

```
#12  Filtro por fecha en envíos
     planning · riesgo bajo · Arian1192/promos → dev · versión 3

Descripción
  Añadir un filtro por rango de fechas en la lista de envíos.

Criterio de aceptación
  Al elegir un rango, solo aparecen los envíos de esas fechas.
```

Un texto destruido con `erase` se muestra como `[borrado]`, en gris, nunca como vacío.

**`togi daemon start`**:

```
✓ Daemon en marcha (pid 48213) · ~/.togi/run/togi.sock
```

## Color, símbolos y accesibilidad

El color refuerza, nunca carga solo el significado: cada estado lleva también un símbolo y una palabra. Los colores salen de cinco tokens semánticos, que se mapearán a la paleta del manual de marca de togi cuando esté en el proyecto.

| Token | Uso | Símbolo | Sin Unicode |
| --- | --- | --- | --- |
| `ok` | Operación hecha, verificación en verde | `✓` | `ok` |
| `attention` | Espera una decisión tuya | `●` | `*` |
| `error` | Fallo, integridad rota | `✗` | `x` |
| `muted` | En curso, secundario, `[borrado]` | `·` | `-` |
| `accent` | Números de tarea, comandos sugeridos | ninguno | ninguno |

- **Sin color** si la salida no es una terminal, si existe `NO_COLOR` o con `--no-color`; `FORCE_COLOR` lo fuerza.
- **Sin símbolos Unicode** con `TERM=dumb` o si la configuración regional no es UTF-8: se usa la columna de la derecha.
- **Sin animaciones** fuera de una terminal: nada de spinners en logs ni en CI.
- **Contraste:** al mapear los tokens a la marca, cada color debe leerse sobre fondo claro y oscuro.

## Errores

Cada error dice qué pasó, qué hacer y, en gris, el código y el `X-Request-Id` para buscarlo en el log. Va siempre a stderr.

```
✗ La tarea #12 no tiene criterio de aceptación, así que no puede salir de draft.
  Añádelo con: togi task edit 12
  missing_acceptance_criteria · req 7f3a9c
```

El mensaje sale del `code` del problem+json, nunca del texto libre de la respuesta.

| Código | Mensaje | Siguiente paso |
| --- | --- | --- |
| daemon no disponible | No hay ningún daemon escuchando en el socket. | `togi daemon start` |
| `unauthorized` (401) | El token no es válido. | Revisar `~/.togi/credentials` |
| `task_not_found` (404) | La tarea #N no existe. | `togi status` |
| `missing_acceptance_criteria` (422) | La tarea no tiene criterio de aceptación. | `togi task edit N` |
| `task_final` (422) | La tarea ya está cerrada (estado). | Ninguno |
| `invalid_state` (422) | Esta acción no es posible en el estado actual. | `togi task show N` |
| `invalid_reason` (422) | El rechazo necesita un motivo con texto. | `--reason` |
| `precondition_failed` (412) | La tarea cambió mientras la editabas. | Repetir el comando: la CLI relee la versión |
| `version_conflict` (409) | Otra escritura llegó a la vez. | Repetir el comando |
| `validation_error` (400) | Un valor no es válido, con el campo concreto. | `togi <comando> --help` |
| `integrity_error` (500) | El log o un blob no supera la verificación. | `togi admin verify-log` |

Un `integrity_error` nunca se presenta como un fallo normal: va en rojo y recomienda verificar el log, porque puede indicar una manipulación.

## Interactividad

La CLI solo pregunta si está en una terminal interactiva; en un script, falta un dato o una confirmación y falla con código 2.

**Editor.** `togi task new` sin descripción y `togi task edit N` sin flags abren `$EDITOR` con una plantilla. Las líneas con `#` se ignoran; guardar un fichero vacío cancela sin escribir nada.

```
# Tarea #12 · versión 3. Las líneas con # se ignoran.
# Guarda el fichero vacío para cancelar.

## Título
Filtro por fecha en envíos

## Descripción
...

## Criterio de aceptación
...
```

**Confirmaciones.** `togi task reject` pide confirmación nombrando la tarea; `--yes` la omite. Rechazar es definitivo: la tarea queda cerrada. Crear, editar y enviar no preguntan, porque no cierran nada.

**Concurrencia.** La CLI lee la versión con el detalle de la tarea y la envía en `If-Match`. Ante un 412 no reintenta sola, porque sobrescribiría un cambio que no has visto: muestra el error y tú repites el comando.

**Progreso.** Un spinner solo si la operación tarda más de 300 ms y hay terminal, como en `togi daemon start`.

**`togi watch`**: una línea por evento, en directo, con hora, número de evento, tipo y actor. Ctrl+C sale; al reconectar continúa desde el último evento visto.

```
14:02:11  #41  task.created    #16  Arian
14:05:37  #42  task.edited     #16  Arian
14:06:02  #43  task.submitted  #16  Arian
```

## Salida para máquinas

Con `--json`, cada comando escribe en stdout un único objeto JSON con la misma forma que la respuesta de la API, sin colores ni símbolos. Los errores van a stderr como el problem+json recibido, y `togi watch --json` escribe un objeto por línea.

- **stdout:** solo datos. **stderr:** mensajes, avisos y errores. Un script puede leer stdout sin filtrar nada.
- **Estabilidad:** los campos del JSON solo se añaden, nunca se renombran ni se quitan sin cambiar la versión de la API.

| Código de salida | Significado |
| --- | --- |
| 0 | Hecho |
| 1 | Error inesperado o de integridad |
| 2 | Uso incorrecto: flags, argumentos o falta una confirmación fuera de una terminal |
| 3 | Una regla del flujo lo impide (422) |
| 4 | Conflicto de versión (409 o 412) |
| 5 | No autenticado (401) |
| 6 | Daemon no disponible |
| 7 | No encontrado (404) |

Con estos códigos, un script distingue «repite» (4), «arranca el daemon» (6) y «no insistas» (3) sin leer el mensaje.

## Referencias e inspiración

La estética de [Charm](https://github.com/charmbracelet) es la referencia visual: color con intención, tablas limpias y espaciado generoso. Su tecnología no entra en la CLI de la rebanada 1, porque casi todo está en Go y la CLI comparte los tipos del daemon en TypeScript (ADR-002).

| De Charm | Uso en togi | Cuándo |
| --- | --- | --- |
| Lip Gloss y su estilo | Solo como referencia visual; los estilos se implementan en TypeScript con los tokens de color | PR 10 |
| VHS | Herramienta de desarrollo, fuera de togi: demos del README generadas desde un guion, y pruebas visuales que detectan cambios en la salida | Cuando haya demos o pruebas visuales |
| Bubble Tea | Posible interfaz interactiva (`togi inbox`) como otro cliente de la API, frente a Ink en TypeScript | Decisión en la rebanada 2 |

Como la CLI solo habla con la API, una interfaz interactiva en Go sería un cliente más, igual que la web UI o la app Tauri. La elección es un intercambio: Bubble Tea da la estética nativa de Charm; Ink conserva los tipos compartidos con el daemon.

## Ayuda y decisiones pendientes

`togi --help` y `togi <comando> --help` muestran el uso, los flags y al menos un ejemplo real; un comando mal escrito sugiere el más parecido.

```
Uso: togi task reject <número> --category <categoría> --reason <texto> [--yes]

Rechaza una tarea. Es definitivo: la tarea queda cerrada.

Categorías: misunderstanding, scope, logic, tests, style, other

Ejemplo:
  togi task reject 12 --category scope --reason "Duplica la #9"
```

```
✗ Comando desconocido: togi task sumbit
  ¿Querías decir togi task submit?
```

Pendiente de decidir:

- [ ] Mapear los cinco tokens de color a la paleta del manual de marca de togi, con contraste en fondo claro y oscuro.
- [x] Decidir si el título de las tareas se cifra (ADR-004): se cifra como `task_text`. La API devuelve `[borrado]` si su clave se destruyó, y así lo muestra la CLI.
- [ ] Decidir en la rebanada 2 si `togi inbox` se construye con Ink (TypeScript) o con Bubble Tea (Go), tras comprobar el estado de las dos.
