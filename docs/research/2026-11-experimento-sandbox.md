# RESULTADOS — spike de sandbox para agentes de togi

Generado: 2026-11-04T13:01:06.041Z · host: macOS 25.6.0 arm64 · Node v24.22.1
Versiones: srt 0.0.81 · microsandbox 0.7.8 (imagen `node:24-bookworm`) · Agent SDK 0.3.305

Credenciales usadas: apikey = FALSA (solo valida el mecanismo) · oauth = REAL (del entorno del lanzador)

Leyenda: **OK** cumple lo esperado · **FALLO** no lo cumple · **PARCIAL** cumple a medias (ver observaciones) · **N/A** no aplica.
**BLOQUEADO** = el sandbox impide un acceso que existiría (hay control positivo sin sandbox). **INACCESIBLE POR DISEÑO** = el recurso no existe en ese entorno (microVM Linux); no es mérito del aislamiento. **SIN CONTROL POSITIVO** = tampoco es accesible sin sandbox, el resultado no prueba nada.

## Tabla prueba × candidato × modo

| Prueba | Candidato | Modo | Resultado | Clasificación | Sin sandbox | Observaciones |
|---|---|---|---|---|---|---|
| 1_secrets_dir · Leer ~/togi-spike-secrets | srt | apikey | OK | BLOQUEADO | ALLOWED |  |
| 1_secrets_dir · Leer ~/togi-spike-secrets | srt | oauth | OK | BLOQUEADO | ALLOWED |  |
| 1_secrets_dir · Leer ~/togi-spike-secrets | microsandbox | apikey | OK | INACCESIBLE POR DISEÑO | ALLOWED | no existe dentro del guest |
| 1_secrets_dir · Leer ~/togi-spike-secrets | microsandbox | oauth | OK | INACCESIBLE POR DISEÑO | ALLOWED | no existe dentro del guest |
| 2a_ssh_readable · ~/.ssh legible (test -r) | srt | apikey | OK | BLOQUEADO | ALLOWED |  |
| 2a_ssh_readable · ~/.ssh legible (test -r) | srt | oauth | OK | BLOQUEADO | ALLOWED |  |
| 2a_ssh_readable · ~/.ssh legible (test -r) | microsandbox | apikey | OK | INACCESIBLE POR DISEÑO | ALLOWED | no existe dentro del guest |
| 2a_ssh_readable · ~/.ssh legible (test -r) | microsandbox | oauth | OK | INACCESIBLE POR DISEÑO | ALLOWED | no existe dentro del guest |
| 2b_aws_readable · ~/.aws legible (test -r) | srt | apikey | OK | SIN CONTROL POSITIVO | DENIED | el recurso tampoco es accesible sin sandbox |
| 2b_aws_readable · ~/.aws legible (test -r) | srt | oauth | OK | SIN CONTROL POSITIVO | DENIED | el recurso tampoco es accesible sin sandbox |
| 2b_aws_readable · ~/.aws legible (test -r) | microsandbox | apikey | OK | SIN CONTROL POSITIVO | DENIED | el recurso tampoco es accesible sin sandbox |
| 2b_aws_readable · ~/.aws legible (test -r) | microsandbox | oauth | OK | SIN CONTROL POSITIVO | DENIED | el recurso tampoco es accesible sin sandbox |
| 3_keychain · security find-generic-password -s togi-spike -w | srt | apikey | OK | BLOQUEADO | ALLOWED |  |
| 3_keychain · security find-generic-password -s togi-spike -w | srt | oauth | OK | BLOQUEADO | ALLOWED |  |
| 3_keychain · security find-generic-password -s togi-spike -w | microsandbox | apikey | OK | INACCESIBLE POR DISEÑO | ALLOWED | no existe dentro del guest |
| 3_keychain · security find-generic-password -s togi-spike -w | microsandbox | oauth | OK | INACCESIBLE POR DISEÑO | ALLOWED | no existe dentro del guest |
| 4a_unix_socket · Conectar al socket Unix falso | srt | apikey | OK | BLOQUEADO | ALLOWED |  |
| 4a_unix_socket · Conectar al socket Unix falso | srt | oauth | OK | BLOQUEADO | ALLOWED |  |
| 4a_unix_socket · Conectar al socket Unix falso | microsandbox | apikey | OK | INACCESIBLE POR DISEÑO | ALLOWED | no existe dentro del guest |
| 4a_unix_socket · Conectar al socket Unix falso | microsandbox | oauth | OK | INACCESIBLE POR DISEÑO | ALLOWED | no existe dentro del guest |
| 4b_tcp_loopback · Conectar a 127.0.0.1:TCP del daemon falso | srt | apikey | OK | BLOQUEADO | ALLOWED |  |
| 4b_tcp_loopback · Conectar a 127.0.0.1:TCP del daemon falso | srt | oauth | OK | BLOQUEADO | ALLOWED |  |
| 4b_tcp_loopback · Conectar a 127.0.0.1:TCP del daemon falso | microsandbox | apikey | OK | INACCESIBLE POR DISEÑO | ALLOWED | no existe dentro del guest |
| 4b_tcp_loopback · Conectar a 127.0.0.1:TCP del daemon falso | microsandbox | oauth | OK | INACCESIBLE POR DISEÑO | ALLOWED | no existe dentro del guest |
| 4c_dns_exfil · Exfiltración por DNS: subdominio inventado de un dominio no permitido | srt | apikey | OK | BLOQUEADO | ALLOWED |  |
| 4c_dns_exfil · Exfiltración por DNS: subdominio inventado de un dominio no permitido | srt | oauth | OK | BLOQUEADO | ALLOWED |  |
| 4c_dns_exfil · Exfiltración por DNS: subdominio inventado de un dominio no permitido | microsandbox | apikey | OK | BLOQUEADO | ALLOWED |  |
| 4c_dns_exfil · Exfiltración por DNS: subdominio inventado de un dominio no permitido | microsandbox | oauth | OK | BLOQUEADO | ALLOWED |  |
| 4d_host_gateway · Loopback del Mac (daemon falso) a través de la pasarela de la VM | srt | apikey | N/A | | | no aplica: srt no usa VM ni pasarela (su equivalente es 4b) |
| 4d_host_gateway · Loopback del Mac (daemon falso) a través de la pasarela de la VM | srt | oauth | N/A | | | no aplica: srt no usa VM ni pasarela (su equivalente es 4b) |
| 4d_host_gateway · Loopback del Mac (daemon falso) a través de la pasarela de la VM | microsandbox | apikey | OK | BLOQUEADO | ALLOWED (política permisiva) |  |
| 4d_host_gateway · Loopback del Mac (daemon falso) a través de la pasarela de la VM | microsandbox | oauth | OK | BLOQUEADO | ALLOWED (política permisiva) |  |
| 5a_net_allowed · Red: api.anthropic.com responde | srt | apikey | OK |  | ALLOWED |  |
| 5a_net_allowed · Red: api.anthropic.com responde | srt | oauth | OK |  | ALLOWED |  |
| 5a_net_allowed · Red: api.anthropic.com responde | microsandbox | apikey | OK |  | ALLOWED |  |
| 5a_net_allowed · Red: api.anthropic.com responde | microsandbox | oauth | OK |  | ALLOWED |  |
| 5b_net_blocked · Red: example.com | srt | apikey | OK | BLOQUEADO | ALLOWED |  |
| 5b_net_blocked · Red: example.com | srt | oauth | OK | BLOQUEADO | ALLOWED |  |
| 5b_net_blocked · Red: example.com | microsandbox | apikey | OK | BLOQUEADO | ALLOWED |  |
| 5b_net_blocked · Red: example.com | microsandbox | oauth | OK | BLOQUEADO | ALLOWED |  |
| 6a_write_worktree · Escribir en el worktree | srt | apikey | OK | BLOQUEADO | ALLOWED |  |
| 6a_write_worktree · Escribir en el worktree | srt | oauth | OK | BLOQUEADO | ALLOWED |  |
| 6a_write_worktree · Escribir en el worktree | microsandbox | apikey | OK | BLOQUEADO | ALLOWED |  |
| 6a_write_worktree · Escribir en el worktree | microsandbox | oauth | OK | BLOQUEADO | ALLOWED |  |
| 6b_write_outside · Escribir fuera del worktree y del scratch | srt | apikey | OK | BLOQUEADO | ALLOWED |  |
| 6b_write_outside · Escribir fuera del worktree y del scratch | srt | oauth | OK | BLOQUEADO | ALLOWED |  |
| 6b_write_outside · Escribir fuera del worktree y del scratch | microsandbox | apikey | PARCIAL |  | ALLOWED | escribe en el rootfs EFÍMERO del guest (overlay); no alcanza ningún fichero del host |
| 6b_write_outside · Escribir fuera del worktree y del scratch | microsandbox | oauth | PARCIAL |  | ALLOWED | escribe en el rootfs EFÍMERO del guest (overlay); no alcanza ningún fichero del host |
| 6c_write_scratch · Escribir en el scratch (control) | srt | apikey | OK |  | ALLOWED |  |
| 6c_write_scratch · Escribir en el scratch (control) | srt | oauth | OK |  | ALLOWED |  |
| 6c_write_scratch · Escribir en el scratch (control) | microsandbox | apikey | OK |  | ALLOWED |  |
| 6c_write_scratch · Escribir en el scratch (control) | microsandbox | oauth | OK |  | ALLOWED |  |
| 7_env_fake_secret · SPIKE_FAKE_SECRET visible en el entorno | srt | apikey | OK | BLOQUEADO | ALLOWED |  |
| 7_env_fake_secret · SPIKE_FAKE_SECRET visible en el entorno | srt | oauth | OK | BLOQUEADO | ALLOWED |  |
| 7_env_fake_secret · SPIKE_FAKE_SECRET visible en el entorno | microsandbox | apikey | OK | BLOQUEADO | ALLOWED |  |
| 7_env_fake_secret · SPIKE_FAKE_SECRET visible en el entorno | microsandbox | oauth | OK | BLOQUEADO | ALLOWED |  |
| 8_env_api_key · Valor real de ANTHROPIC_API_KEY en el entorno | srt | apikey | OK | BLOQUEADO | ALLOWED | el guest recibe solo un marcador (variable presente, valor distinto) |
| 8_env_api_key · Valor real de ANTHROPIC_API_KEY en el entorno | srt | oauth | N/A | | | modo suscripción: no hay clave de API |
| 8_env_api_key · Valor real de ANTHROPIC_API_KEY en el entorno | microsandbox | apikey | OK | BLOQUEADO | ALLOWED | el guest recibe solo un marcador (variable presente, valor distinto) |
| 8_env_api_key · Valor real de ANTHROPIC_API_KEY en el entorno | microsandbox | oauth | N/A | | | modo suscripción: no hay clave de API |

## 7. El agente completa su tarea

| Candidato | Modo | Estado | Observaciones |
|---|---|---|---|
| srt | 7a clave de API | SKIPPED (sin credencial real) | con credencial falsa el agente llega a la API y esta rechaza la credencial (401); la tarea no se ha podido verificar |
| srt | 7b suscripción | OK | razón: success |
| microsandbox | 7a clave de API | SKIPPED (sin credencial real) | con credencial falsa el agente llega a la API y esta rechaza la credencial (401); la tarea no se ha podido verificar |
| microsandbox | 7b suscripción | OK | razón: success |

### Control positivo de 7a/7b (mismo agente, mismo entorno mínimo, SIN sandbox)

| Modo | Control sin sandbox | Entorno del agente en srt | Entorno del agente en microsandbox |
|---|---|---|---|
| 7a | no ejecutado (sin credencial real) | apikey=1 authtoken=0 oauth=0 oauth_len=0 oauth_shape=none source=ANTHROPIC_API_KEY | apikey=1 authtoken=0 oauth=0 oauth_len=0 oauth_shape=none source=ANTHROPIC_API_KEY |
| 7b | OK (success) · apikey=0 authtoken=0 oauth=1 oauth_len=108 oauth_shape=oat source=none | apikey=0 authtoken=0 oauth=1 oauth_len=108 oauth_shape=oat source=none | apikey=0 authtoken=0 oauth=1 oauth_len=108 oauth_shape=oat source=none |

Si el control sin sandbox falla igual que el sandbox, el fallo no es del aislamiento sino de la credencial o del agente.

## 8. Tiempos

| Candidato | Modo | Arranque del sandbox (ms) | Tarea completa del agente (ms) |
|---|---|---|---|
| srt | apikey | 138 | 6129 (intento con credencial falsa: no es la tarea real) |
| srt | oauth | 76 | 15931 |
| microsandbox | apikey | 526 | 4706 (intento con credencial falsa: no es la tarea real) |
| microsandbox | oauth | 396 | 18334 |

Arranque = srt: `initialize()` + primer comando; microsandbox: `create()` + primer `exec` con la imagen ya descargada (la primera descarga tardó minutos y no cuenta).

## 9. Destinos de red que el agente intentó alcanzar y fueron bloqueados

- **srt / apikey**: `http-intake.logs.us5.datadoghq.com:443`
- **srt / oauth**: `http-intake.logs.us5.datadoghq.com:443`
- **microsandbox / apikey**: `http-intake.logs.us5.datadoghq.com`
- **microsandbox / oauth**: `http-intake.logs.us5.datadoghq.com`

Lectura: el agente solo *necesita* `api.anthropic.com`; el resto son intentos accesorios (p. ej. telemetría). srt los registra como destinos consultados al callback de red; microsandbox no expone un registro de denegaciones por la API: se infieren de las consultas DNS del `runtime.log` (nivel debug); una consulta denegada queda registrada aunque se conteste NXDOMAIN en local. Esta lista procede de ejecuciones con credencial falsa: con credenciales reales el agente puede intentar más destinos.

## Hallazgos y limitaciones

- Sin control positivo en este host para: `2b_aws_readable` (el recurso no existe o no es accesible sin sandbox).
- srt solo se ha probado en **macOS (Seatbelt)**; su comportamiento en Linux (bubblewrap/seccomp) no se ha ejercitado aquí.
- srt: la lectura es *permitir por defecto*; el aislamiento de lectura depende de `denyRead: [HOME]` + `allowRead` explícito. Cualquier ruta fuera de HOME (p. ej. `/etc`) sigue legible.
- microsandbox: el rootfs del guest es escribible y efímero (overlay): la prueba 6b da PARCIAL; no hay forma de que alcance el host, pero "escritura fuera del worktree" no está bloqueada dentro del guest.
- microsandbox: 4b prueba el loopback *del guest*; el loopback del Mac por la pasarela se prueba aparte en 4d y en el anexo C.
- Modo suscripción: el token OAuth entra en el sandbox con su valor real (no se enmascara) salvo que se lance con `SPIKE_MASK_OAUTH=1`, que aplica el mismo enmascarado/sustitución que a la clave de API (no verificado con token real).
- Con credenciales falsas, 7a/7b quedan **SKIPPED**: se valida el mecanismo de enmascarado (la sonda 8) pero no que la autenticación sustituida funcione de extremo a extremo.

## Anexo — laboratorio de microsandbox (credenciales siempre falsas)

### A. DNS: ¿se puede bloquear la resolución de nombres no permitidos?

Se apunta el reenviador DNS de microsandbox a un servidor de captura en el Mac (`nameservers(["127.0.0.1:puerto"])`): lo que le llega es exactamente lo que *sale* de la pasarela hacia el exterior.

| Política | api.anthropic.com | example.com | subdominio inventado de dominio no permitido | UDP/53 directo a 1.1.1.1 | Nombres que llegaron al resolvedor externo |
|---|---|---|---|---|---|
| con regla allowDns (configuración anterior) | RESUELVE | RESUELVE | RESUELVE | bloqueado | `api.anthropic.com`, `example.com`, `<rnd>-dato-exfiltrado.exfil.example.org` |
| sin allowDns: solo la regla de dominio | RESUELVE | NXDOMAIN | NXDOMAIN | bloqueado | `api.anthropic.com` |

**Sí se puede bloquear.** La documentación lo dice y el experimento lo confirma: cada consulta DNS pasa por la política de egreso y una *regla de dominio* basta para resolver ese nombre. Basta con **no** añadir `Rule.allowDns()` (ni usar los perfiles `public`/`private`/`host`, que lo incluyen): el resto de nombres recibe NXDOMAIN local y la consulta ni sale al exterior. Con `allowDns()` (mi configuración inicial) el subdominio inventado sí llegó al resolvedor externo: exfiltración posible. El runner del experimento ya usa la política sin `allowDns()`. Matiz: la regla es por nombre exacto (`allowDomain`); un `allowDomainSuffix` permitiría también los subdominios arbitrarios de ese sufijo y reabriría el canal hacia él.

### B. api.anthropic.com según la lista de dominios y la interceptación TLS

Política común: deny por defecto + `allowDomain("api.anthropic.com")` en TCP/443 (sin `allowDns`). "HTTP" es la respuesta a un `POST /v1/messages` con clave inventada: **401 = llegó a la API de Anthropic y esta rechazó la credencial**; 000 = no hubo conexión. "Emisor" es la CA que firma el certificado que ve el guest.

| Cfg | Configuración | HTTP | Emisor del certificado | Agente (SDK) | ¿Puede hablar con el modelo? |
|---|---|---|---|---|---|
| T1 | lista de dominios, SIN interceptación TLS (strict por defecto) | 000 | — | timeout (60 s sin completar) | NO |
| T2 | lista de dominios + interceptación TLS en 443 | 401 | microsandbox CA; O=microsandbox | api_rejected_credential | SÍ |
| T3 | lista de dominios + interceptación TLS + secreto (modo clave de API) | 401 | microsandbox CA; O=microsandbox | api_rejected_credential | SÍ |
| T4 | lista de dominios, SIN TLS, con strict(false) | 401 | WE1 | api_rejected_credential | SÍ |
| T5 | interceptación TLS pero api.anthropic.com en bypass (túnel opaco) | 000 | — | timeout (60 s sin completar) | NO |

Qué pasa exactamente:
- **T1** (sin interceptación, `strict` por defecto): una regla por *hostname* necesita ver el nombre; sin MITM el SNI va cifrado dentro de un túnel que microsandbox no inspecciona, así que deniega ("TCP egress denied by strict hostname policy", visto en `runtime.log`). El agente se queda esperando una conexión que nunca se abre.
- **T2/T3** (interceptación en 443): el gateway termina TLS con su CA (el guest la confía), lee el SNI, aplica la regla y abre la conexión real hacia el exterior. El certificado que ve el guest lo firma la CA de microsandbox. **El agente habla con el modelo.** T3 añade el secreto: el guest solo tiene un marcador y el gateway lo sustituye por la clave real al salir hacia `api.anthropic.com`. **Para el modo clave de API con marcador, T3 es la única configuración válida** (los secretos exigen interceptación).
- **T4** (`strict(false)`, sin MITM): la conexión se permite y el certificado es el real (emisor de Google Trust Services); el agente habla con el modelo sin que el gateway toque el TLS. Coste: la regla ya no se verifica contra el SNI, solo contra la IP asociada al nombre por el DNS; según la documentación, `strict` es lo que hace fallar en cerrado a las listas de hostnames. Es válida para el modo suscripción con token en claro, pero **no admite secretos/marcadores**.
- **T5** (interceptación activa pero `api.anthropic.com` en `bypass`): el bypass lo convierte en túnel opaco y la política estricta lo deniega igual que en T1.

Conclusión: el agente puede hablar con el modelo en **T2, T3 y T4**. Recomendada: **T3 (clave de API con marcador)** o **T2 (suscripción)**, ambas con `strict` activo.

### C. ¿Se alcanza el 127.0.0.1 del Mac desde la VM por la pasarela?

El daemon falso escucha solo en `127.0.0.1:47831` del Mac. Desde la VM se conecta a la IP de la pasarela (ruta por defecto) y a `host.microsandbox.internal`.

| Cfg | Política | Pasarela (IP) | host.microsandbox.internal |
|---|---|---|---|
| H1 | política del experimento (deny por defecto + api.anthropic.com) | DENIED | DENIED |
| H2 | perfil "host" (control positivo: permite la pasarela) | ALLOWED | ALLOWED |
| H3 | allowAll (control positivo) | ALLOWED | ALLOWED |

**Con la política del experimento (H1) no se alcanza.** Los controles positivos H2 (perfil `host`) y H3 (`allowAll`) sí conectan, así que el camino VM → pasarela → loopback del Mac existe y lo único que lo cierra es la política de egreso: cualquier política que incluya el grupo `host` (o `allowAll`) expone todos los servicios que escuchen en el loopback del Mac, incluido el daemon real de togi.
