# Batería de conformidad del sandbox: hallazgos del PR 10

5 de noviembre de 2026 · SrtSandbox con srt 0.0.81, macOS 25.6.0

La batería vive en `packages/worker/src/sandbox/testing/` y se ejecuta contra `SrtSandbox`. Cada sonda tiene su control positivo sin sandbox. De las 19, 18 pasan y 1 queda como `todo`.

## Fallo conocido: un proceso con `setsid` sobrevive a la ejecución

**Sonda:** `escapar-del-tope`. Un proceso hace `fork`, el hijo llama a `setsid()` y sigue durmiendo. Tras `run()` se comprueba si su PID sigue vivo.

**Resultado:** sobrevive. Tras terminar la ejecución con normalidad el proceso sigue vivo. No se ha probado con el tope de tiempo, pero ese camino usa el mismo `killGroup`.

**Causa:** `execute()` en `srt-sandbox.ts` lanza el hijo con `detached: true` y, al terminar, mata el grupo con `process.kill(-pid, "SIGKILL")`. Un proceso que crea su propia sesión con `setsid` sale de ese grupo, y `kill(-pid)` ya no lo alcanza. El sandbox sigue aplicado a ese proceso (hereda el perfil de Seatbelt), pero queda vivo y fuera de control del trabajador: el tope de 10 minutos deja de ser un tope.

**Estado:** la sonda es un `todo` de `node:test`. No rompe la CI, pero queda visible en cada ejecución. **Ningún PR que lance un agente real se mergea mientras la batería tenga un `todo`.**

**Arreglo posible (PR aparte):** contar los procesos descendientes por árbol (por ejemplo, recorriendo `ppid` o con `pgrep -P` recursivo) y matarlos todos al terminar, o aislar la ejecución en un espacio de procesos propio. Hay que comprobar que un proceso huérfano con `setsid` no escapa del recorrido por `ppid` al reasignarse su padre a `launchd`; probablemente sí escapa, así que el árbol por sí solo no basta.

## Notas de diseño de las sondas

- **Llavero:** lo protege el `denyRead` de la carpeta personal sobre el **fichero** del Llavero (`~/Library/Keychains`), no un bloqueo del servicio del sistema. Lo demuestra el control: con un llavero temporal desbloqueado fuera de la carpeta personal, `security` lo leía desde dentro del sandbox, así que srt deja alcanzable el servicio del Llavero. La entrada falsa vive por eso en un llavero temporal dentro de `~/Library/Keychains` de la carpeta personal falsa, como el real. Se crea y se borra en la propia batería. Si `security create-keychain` falla, la sonda se omite con el motivo visible. Consecuencia: un llavero fuera de la carpeta personal, o una carpeta personal mal configurada en `denyRead`, reabre el acceso.
- **DNS:** la sonda resuelve un nombre real de un dominio no permitido. No verifica que un subdominio inventado salga al exterior (eso exigiría un resolvedor de captura, como en el anexo A del experimento).
- **Red:** el control positivo y la sonda permitida llaman a `api.anthropic.com` sin credenciales; cualquier respuesta HTTP cuenta como conexión. Sin Internet, el control falla y la sonda se omite con el motivo visible, nunca pasa.
- **Socket Unix:** en `/tmp/tc-*`, porque macOS limita la ruta de un socket a 104 caracteres y `tmpdir()` la supera.
- **Credencial enmascarada:** se comprueba que el hijo recibe un marcador y no el valor real; no se hace ninguna petición con la credencial.
