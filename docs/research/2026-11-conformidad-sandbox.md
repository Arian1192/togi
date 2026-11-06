# Batería de conformidad del sandbox: hallazgos del PR 10

5 de noviembre de 2026 · SrtSandbox con srt 0.0.81, macOS 25.6.0

La batería vive en `packages/worker/src/sandbox/testing/` y se ejecuta contra `SrtSandbox`. Cada sonda tiene su control positivo sin sandbox. Las 24 sondas pasan y no queda ningún `todo`. Las tres secciones siguientes son hallazgos que la batería encontró y que ya están cerrados.

## Cerrado: un proceso con `setsid` sobrevive a la ejecución

**Sonda:** `escapar-del-tope`. Un proceso hace `fork`, el hijo llama a `setsid()` y sigue durmiendo. Tras `run()` se comprueba si su PID sigue vivo.

**Resultado:** sobrevive. Tras terminar la ejecución con normalidad el proceso sigue vivo. No se ha probado con el tope de tiempo, pero ese camino usa el mismo `killGroup`.

**Causa:** `execute()` en `srt-sandbox.ts` lanza el hijo con `detached: true` y, al terminar, mata el grupo con `process.kill(-pid, "SIGKILL")`. Un proceso que crea su propia sesión con `setsid` sale de ese grupo, y `kill(-pid)` ya no lo alcanza. El sandbox sigue aplicado a ese proceso (hereda el perfil de Seatbelt), pero queda vivo y fuera de control del trabajador: el tope de 10 minutos deja de ser un tope.

**Estado:** cerrado en el PR 13a (`Reaper`, `reap.ts`). Al empezar y al terminar cada ejecución (fin normal, tope de tiempo o cancelación) se mata todo lo que la ejecución creó, combinando tres capas: el árbol de procesos muestreado mientras corre, la marca `TOGI_RUN` del entorno y un fichero abierto que el hijo hereda y que `lsof` encuentra en cualquier proceso. La sonda `escapar-del-tope` pasa y ya no es un `todo`. Riesgo que queda: un proceso hostil que evada las tres capas sigue dentro del Seatbelt; el riesgo concreto es el uso no autorizado de la API con la clave. La solución fuerte es la VM de la rebanada 3.

### Los binarios de Apple y el arreglo del Reaper

**Fallo:** la marca de entorno no basta con un binario de Apple, porque `ps -E` no muestra su entorno. Y tras un `SIGKILL` al trabajador, un escapado que era un binario de Apple sobrevivía, porque la marca de fichero solo vivía en la memoria del trabajador muerto. **Prueba:** `worker-launcher.srt.test.ts`, «tras SIGKILL al trabajador, la sesión siguiente elimina a un escapado de Apple (sleep)»: el agente se escapa con `setsid` ejecutando `sleep`, el daemon mata al trabajador con `SIGKILL` y la sesión siguiente debe eliminar al escapado al empezar. Era un `todo`.

**Arreglo:** la marca tiene un enlace duro en `TOGI_HOME/run`, fuera del alcance del sandbox, y `begin()` barre con `lsof` las marcas de ejecuciones anteriores, también las de un trabajador muerto. Si el agente borra su nombre de la marca, el enlace sigue. La marca de entorno se acota además al `run/` de su `TOGI_HOME`, para que el `begin()` de un trabajador no barra los escapados de otro. Con eso el #92 pasó ese test de `todo` a test normal, y hoy pasa.

## Cerrado: el agente lee todo lo que está fuera de la carpeta personal

7 de noviembre de 2026 · tarea #24

**Sondas:** `tmp-sistema` (un fichero en `/tmp`), `tmp-usuario` (uno en `os.tmpdir()`, `/var/folders/…/T`) y `compartido` (uno en `/Users/Shared`). Cada una es `DENIED` y lleva su control positivo sin sandbox, que da `ALLOWED`. El control positivo de lectura de la copia del repo (`lectura-permitida`) pasa.

**Resultado:** las tres leen el señuelo dentro del sandbox. El fallo es del resultado (`ALLOWED` en vez de `DENIED`), no del control.

**Causa:** `toSrtConfig` solo pone la carpeta personal en `denyRead`. Lo que está fuera de ella, incluidas las carpetas temporales, las compartidas y las de otros usuarios, queda legible. Esto explica también que el control negativo de `claude-binary.srt.test.ts` falle con la copia del código en `/tmp`: el SDK encuentra allí el binario sin que se le dé la ruta.

**Arreglo:** `denyRead` pasa de `[home]` a `[home, /Users, /Volumes, /private/tmp, <temporal del usuario>]`. La temporal del usuario es el padre de `T/` en `/var/folders/xx/yyyy` (con `C/`, las cachés de otras aplicaciones, y `0/`), no solo `T/`. `allowRead` sigue reabriendo la copia del repo, el scratch y el entorno de ejecución aunque estén bajo una de esas carpetas: lo prueban `lectura-permitida`, `escritura-permitida` y `node-propio`, cuya escena vive bajo `os.tmpdir()`.

**Estado:** las tres sondas pasan y ya no son `todo`. Los 18 tests `.srt` (SDK, binario nativo y lanzador del trabajador) y la batería (42 tests en total) pasan con el código en el repo, en `/tmp` y en `~/Library/Application Support`. El control negativo de `claude-binary.srt.test.ts`, que fallaba con la copia en `/tmp`, pasa ahora en cualquier ubicación.

**Lo que no cubre:** la lectura sigue siendo una lista de denegación. Lo que no está en `denyRead` (`/opt`, `/private/etc`, `/Applications`, etc.) sigue legible. Cambiarlo a una lista blanca (`denyRead: /`) exigiría enumerar lo que necesitan Node, el SDK y el binario nativo, y queda para un PR aparte.

## Notas de diseño de las sondas

- **Llavero:** lo protege el `denyRead` de la carpeta personal sobre el **fichero** del Llavero (`~/Library/Keychains`), no un bloqueo del servicio del sistema. Lo demuestra el control: con un llavero temporal desbloqueado fuera de la carpeta personal, `security` lo leía desde dentro del sandbox, así que srt deja alcanzable el servicio del Llavero. La entrada falsa vive por eso en un llavero temporal dentro de `~/Library/Keychains` de la carpeta personal falsa, como el real. Se crea y se borra en la propia batería. Si `security create-keychain` falla, la sonda se omite con el motivo visible. Consecuencia: un llavero fuera de la carpeta personal, o una carpeta personal mal configurada en `denyRead`, reabre el acceso.
- **DNS:** la sonda resuelve un nombre real de un dominio no permitido. No verifica que un subdominio inventado salga al exterior (eso exigiría un resolvedor de captura, como en el anexo A del experimento).
- **Red:** el control positivo y la sonda permitida llaman a `api.anthropic.com` sin credenciales; cualquier respuesta HTTP cuenta como conexión. Sin Internet, el control falla y la sonda se omite con el motivo visible, nunca pasa.
- **Socket Unix:** en `/tmp/tc-*`, porque macOS limita la ruta de un socket a 104 caracteres y `tmpdir()` la supera.
- **Credencial enmascarada:** se comprueba que el hijo recibe un marcador y no el valor real; no se hace ninguna petición con la credencial.
