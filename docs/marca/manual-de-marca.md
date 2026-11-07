# Manual de marca de togi

4 de noviembre de 2026 · Arian

## Cómo usar este manual

Este manual dice cómo se ve, cómo suena y cómo se construye togi en cualquier superficie: la web UI, la CLI, la documentación, la landing y las herramientas que se hagan alrededor. Está escrito para quien diseña interfaces (UX/UI) y para quien las implementa (frontend).

- **Fuente de verdad de los valores:** el [sistema de diseño de togi](https://claude.ai/artifact/RsGot26mzbUq1wsuWuqrUq). Sus tokens (`tokens.json`) mandan sobre cualquier valor copiado en este documento o en un fichero de diseño.
- **Fuente de verdad de las reglas:** este manual. Si un caso no está cubierto, la pregunta es qué haría un buen revisor: decir qué ha pasado, qué falta y quién tiene que actuar.
- **Cambios:** un cambio de marca se propone con un comentario en este documento y se aplica primero en el sistema de diseño, luego aquí. Nunca al revés.

## La marca en una página

togi es una software factory con IA: un daemon que lleva cada tarea por un flujo con gates automáticos y aprobación humana. Su promesa no es ir más rápido, sino que cada cambio llegue **pequeño, verificado y revisable**.

- **El nombre.** *Togi* (研ぎ) es el pulido de la espada japonesa. El *togishi* (研師), el pulidor, trabaja después del herrero; su pulido saca a la luz los defectos de la hoja antes de darla por buena. togi hace lo mismo con el código de los agentes.
- **Cómo se escribe.** Siempre en minúsculas: **togi**, también a principio de frase y en títulos. En japonés, siempre 研ぎ, nunca 伽, que se lee igual y significa otra cosa.
- **Carácter.** Un taller, no una postal: sobrio, preciso, artesanal. Referencias: el cuaderno de un oficio, una imprenta, una herramienta bien cuidada.
- **Lema.** *Cambios pequeños, verificados y revisables.*

## Voz y tono

togi habla como un buen revisor: dice qué ha pasado, qué falta y quién tiene que actuar, en español y sin adornos.

1. **Hechos antes que adjetivos.** Cuenta lo que se ha comprobado y con qué resultado.
2. **Ninguna cifra sin fuente.** Si un número es una estimación, se dice; si no se sabe, no se escribe.
3. **Quién actúa, siempre claro.** Cada mensaje de estado deja ver si la tarea la tiene un agente, un gate o una persona.
4. **El problema y el siguiente paso juntos.** Un error explica qué falló y qué puedes hacer.
5. **Sin entusiasmo de producto.** Sin exclamaciones, sin emoji, sin "¡Genial!" ni "potente".
6. **Los estados como en la API, el texto en español.** `plan_review`, `verifying`; la frase que los acompaña, en español.

| En lugar de | Escribe |
| --- | --- |
| ¡Todo listo! 🎉 | 5 de 5 gates en verde. Puedes mergear. |
| Algo salió mal | El gate `tests` falló: 2 de 38 tests en rojo. |
| Casi listo | `verifying` · 3 de 5 gates completados |
| Tu agente inteligente ha terminado | El builder entregó el diff. Lo están verificando los gates. |
| Error 409 | Hay otra tarea en `building` en este repo. Espera a que termine o cancélala. |
| Mejora tu productividad | Revisas el plan antes de que se escriba el código. |

El tratamiento es de tú. Los botones dicen lo que hacen con un verbo ("Aprobar y mergear en dev", no "Continuar").

## Monograma y logotipo

El símbolo de togi es una t minúscula con el extremo superior del fuste cortado en bisel, como un filo recién asentado en la piedra. Ese corte es toda la idea; el resto de la letra es neutro a propósito.

**Construcción.** Retícula de 64 × 64 unidades. Fuste de 10, travesaño de 9 (un punto más fino para que se vea igual de grueso), bisel de 31°. El travesaño y el gancho inferior terminan en la misma vertical.

| Forma | Fichero | Uso |
| --- | --- | --- |
| Libre | `monograma-filo.svg`, `monograma-sumi.svg` | Junto al logotipo, en la cabecera de la web UI, en documentos |
| Sello (t calada en un cuadrado) | `sello-filo.svg`, `sello-sumi.svg` | Favicon, icono de app, avatar de GitHub y redes |

**Logotipo.** El monograma libre seguido de *togi* en Shippori Mincho 600, en minúsculas. El monograma mide 1,2 veces el cuerpo de la letra y la separación es 0,28 veces el monograma (por ejemplo: monograma de 72 px, texto de 60 px, 20 px entre ambos). Los remates triangulares de la mincho repiten el bisel: por eso esta letra y no otra.

- **Color:** un solo color, el token `ink` del tema (Filo sobre Sumi, Sumi sobre Washi). Usa el fichero de la tinta correcta; no recolorees el SVG.
- **Tamaño mínimo:** 16 px de alto el monograma; 20 px de cuerpo el logotipo completo.
- **Área de respeto:** un cuarto de la altura del monograma por cada lado (16 de 64 unidades). Nada entra en ese margen.
- **Logotipo como texto:** hasta que exista una versión trazada en SVG, se compone con texto vivo en Shippori Mincho. Si la fuente no puede cargarse (correo, una app de terceros), usa el monograma solo.

Usos incorrectos: girar o deformar el monograma; pintarlo en `human` o `agent`; añadir sombras, degradados, contornos o brillos; redibujar la t con otra fuente; poner el logotipo sobre una foto o un fondo con poco contraste; escribir "Togi" o "TOGI".

## Color

La paleta es un taller: neutros de piedra, metal y papel, y solo dos colores con significado. En el código se usan siempre los tokens semánticos, nunca los nombres de la paleta ni el hexadecimal.

| Token | Tema oscuro | Tema claro | Uso |
| --- | --- | --- | --- |
| `bg` | Sumi #141619 | Washi #F4F2ED | Fondo de página |
| `surface` | Piedra #1D2025 | Washi claro #FBFAF7 | Bloques de código, paneles, la terminal |
| `border` | Hierro #2C3036 | Arena #DEDAD2 | Reglas finas y bordes de 1 px. Nunca texto |
| `ink` | Filo #E6E8EA | Sumi #141619 | Texto principal, monograma, botón principal |
| `ink-muted` | Acero #8B9199 | Acero oscuro #5C626A | Texto secundario, metadatos |
| `human` | Shu #E2622F | Shu oscuro #B4421D | La tarea espera a una persona |
| `agent` | Ai #6F9AC7 | Ai oscuro #2F5F91 | La tarea la tiene un agente o un gate |
| `done` | = `ink` | = `ink` | Tarea terminada |

Reglas de Shu (朱) y Ai (藍):

- **Significan, no decoran.** Nunca en fondos de marca, ilustraciones, enlaces, el logotipo ni el resaltado del diff. Si algo es Shu, alguien tiene que actuar.
- **Siempre con su glifo.** El color nunca va solo (ver Estados de una tarea), así la información sobrevive sin color o con daltonismo.
- **Escasos.** En una pantalla normal, Shu aparece en uno o dos sitios. Si está en todas partes, deja de llamar la atención.

Contraste: todo texto cumple 4,5:1 sobre su fondo en los dos temas (por ejemplo, Acero sobre Sumi 5,7:1; Shu oscuro sobre Washi 5,0:1). `border` es decorativo y no basta para distinguir un control: un botón secundario se reconoce por su texto y su forma, no solo por el borde.

## Tipografía

togi usa tres familias de diseño japonés, libres en Google Fonts y con kanji, para que 研ぎ use la misma letra que el texto latino. Cada familia tiene un papel y no se mezclan papeles.

| Familia | Token | Papel | Nunca para |
| --- | --- | --- | --- |
| Shippori Mincho 600 | `font-display` | Logotipo, títulos de página y de sección, numeración de secciones | Texto corrido, botones, etiquetas, datos |
| Zen Kaku Gothic New 400/500 | `font-sans` | Todo el texto de interfaz: párrafos, botones, formularios, navegación | Código o identificadores |
| M PLUS 1 Code 400/500 | `font-mono` | Código, comandos, rutas, estados, identificadores (#12, `togi/12-…`) | Texto que se lee como frase |

| Estilo | Familia | Tamaño / interlineado | Peso |
| --- | --- | --- | --- |
| `wordmark` | display | 64 / 64 px | 600 |
| `heading-1` | display | 40 / 48 px (52 px en portadas de pantalla) | 600 |
| `heading-2` | display | 28 / 36 px | 600 |
| `body` | sans | 15 / 24 px (16 / 26 px en pantallas de lectura) | 400 |
| `label` | sans | 13 / 16 px | 500 |
| `small` | sans | 13 / 20 px | 400 |
| `code` | mono | 14 / 22 px | 400 |
| `code-strong` | mono | 14 / 22 px | 500 |

- Los títulos llevan `text-wrap: balance`; los párrafos, `text-wrap: pretty` y una medida de 60 a 75 caracteres.
- Carga de fuentes: un solo `<link>` de Google Fonts con `display=swap` y solo los pesos de la tabla. Las familias de reserva están en los tokens (Hiragino Mincho, Hiragino Sans, ui-monospace).
- Las fuentes japonesas pesan mucho: en producción, sírvelas con subconjunto de caracteres o autoalojadas.

## Espaciado, retícula y formas

El espacio es la herramienta principal de togi: se separa con aire y con reglas finas, no con cajas.

- **Escala:** 4, 8, 12, 16, 24, 32 y 48 px (`space-1` a `space-12`). Entre secciones de una pantalla, 64 a 88 px; no hay token por debajo de 4 px.
- **Ancho:** contenido en un contenedor de 1240 px como máximo, con 48 px de margen lateral (24 px en móvil). El texto de lectura no pasa de 760 px.
- **Columnas:** el contenido principal y un lateral de evidencia de 340 px; en móvil, el lateral pasa debajo.
- **Separadores:** regla de 1 px en `border`. Una regla en `ink` abre una sección importante (evidencia, decisión): es la versión editorial de un titular.
- **Radios:** `radius-sm` 4 px (campos, etiquetas, código en línea), `radius-md` 6 px (botones), `radius-lg` 10 px (bloques de código y paneles).
- **Profundidad:** sin sombras. Un bloque se separa del fondo con `surface` y un borde de 1 px.
- **Áreas táctiles:** 44 px de alto mínimo en web y táctil (el botón principal, 48 px); 32 px en la app de escritorio, que se usa con puntero.

## Estados de una tarea

Esta tabla es la única definición visual de los estados: la web UI, la CLI y cualquier herramienta usan exactamente estos glifos, tokens y textos.

| Estado | Glifo | Token | Quién la tiene | Texto de ejemplo |
| --- | --- | --- | --- | --- |
| `draft` | ○ | `ink-muted` | Nadie | Falta el criterio de aceptación |
| `planning` | ◐ | `agent` | El planner | Preparando el plan |
| `plan_review` | ◆ | `human` | Tú | Plan v2 · espera tu aprobación |
| `building` | ◐ | `agent` | El builder | Ciclo 1 de 3 |
| `verifying` | ◑ | `agent` | Los gates | 3 de 5 gates completados |
| `review` | ◆ | `human` | Tú | Gates en verde · espera tu revisión |
| `merged` | ● | `done` | Nadie | Mergeada en dev |
| `failed` | ✕ | `human` | Tú | 3 ciclos sin pasar los gates |
| `rejected` | — | `ink-muted` | Nadie | Rechazada: \[motivo\] |

- El glifo va antes del nombre del estado, separado por `space-1`, en `font-mono`.
- **Dónde se dibuja cada glifo.** En las interfaces gráficas (web UI y app de escritorio) los glifos se dibujan como SVG en línea, con trazo de 1,5 px, esquinas rectas y `currentColor` para que tomen el color del token del estado. Ninguna de las tres fuentes de la marca los trae: faltan ◐ ◑ y ✕, y M PLUS 1 Code tampoco trae ◆ ni ●, así que un carácter suelto saldría de la fuente de reserva del sistema y cambiaría de forma. En la terminal son los caracteres de la tabla.
- Las listas de tareas se agrupan por quién tiene que actuar (Pendiente de ti, En curso y Cerradas, los nombres de la CLI y de la app), no por estado ni por fecha.
- Un resultado de gate usa la misma lógica: ● en `ink` si pasa, ◆ en `human` si necesita tu atención (por ejemplo, mutantes que sobreviven), ✕ en `human` si falla.

## Patrones de interfaz

Las pantallas de togi se diseñan como un cuaderno de taller: un documento preparado para que alguien decida, no un panel de administración. La referencia es la pantalla de revisión del lienzo de la web UI.

**El lenguaje del cuaderno**

- **Una pantalla, una decisión.** Cada pantalla responde a una pregunta (¿apruebo este plan?, ¿mergeo este PR?) y tiene un único botón principal, al final.
- **Cabecera fina, sin barra lateral.** Monograma, logotipo, tres o cuatro enlaces y, a la derecha, lo que te espera ("◆ 2 te esperan").
- **Portada de la tarea.** Línea de contexto en `font-mono` y `ink-muted` (repo · #id · riesgo · versión del plan), título en `heading-1` y el criterio de aceptación como entradilla.
- **El recorrido.** Los estados de la tarea como una regla horizontal con su hora; el estado actual, en su color.
- **Secciones numeradas con kanji** (一 二 三 四) en `font-display` y `ink-muted`, delante del título de cada sección.
- **La evidencia explica.** Cada comprobación dice qué hizo, no solo si pasó: "4 tests nuevos, ninguno existente modificado"; "Cambiar >= por > en DateRange.tsx:42 no rompe ningún test".
- **Contenido real en el diseño.** Los mockups usan casos verosímiles, nunca lorem ipsum. Si falta un dato, un marcador visible: \[modelo\], \[repo\].

**Componentes base**

| Componente | Forma | Estados |
| --- | --- | --- |
| Botón principal | Fondo `ink`, texto `bg`, `radius-md`, 48 px de alto, verbo concreto | Hover: 90 % de opacidad. Foco: anillo de 2 px en `ink` a 2 px de distancia. Desactivado: `ink-muted`, con el motivo al lado |
| Botón secundario | Transparente, borde `border`, texto `ink` | Igual que el principal |
| Enlace | Texto en `ink` subrayado; en metadatos, `ink-muted` | Hover: 75 % de opacidad |
| Campo | Fondo `bg`, borde `border`, `radius-sm`, 44 px, etiqueta encima en `label` | Error: borde y mensaje en `human`, con el texto del problema |
| Fila de lista | Regla inferior de 1 px, sin caja; glifo y estado en mono a la izquierda | Toda la fila es un enlace |
| Bloque de código o diff | `surface`, borde, `radius-lg`, `code` | Líneas añadidas con fondo tenue (`surface` un paso más oscuro) y signo +; eliminadas en `ink-muted` con − |
| Etiqueta de estado | Glifo + estado en `font-mono` 13 px, en el token del estado | Sin fondo ni borde |

Iconos: los glifos de estado son el único set propio (SVG en línea, ver «Estados de una tarea»). Para cualquier otro icono, si hace falta, trazo de 1,5 px, esquinas rectas y del color del texto; nunca emoji.

## La CLI

En la terminal no se controla la fuente ni el fondo: la marca son los glifos, dos colores y la forma de escribir.

- **Color:** `human` se aproxima con el naranja/amarillo ANSI (o el truecolor #E2622F si la terminal lo admite) y `agent` con el azul. Todo lo demás, sin color o en atenuado (`dim`).
- **Sin color cuando toca:** si `NO_COLOR` está definido, si se pasa `--no-color` o si la salida no es una terminal, nada de color. Los glifos bastan para entenderlo todo.
- **Cabecera:** la palabra **togi** en negrita, la versión y el estado del daemon. Sin arte ASCII ni banners.
- **Columnas:** alineadas con espacios, en este orden: id, glifo, estado, título, riesgo, nota. La nota dice quién tiene la tarea o qué falta.
- **Salida para máquinas:** `--json` en todos los comandos de lectura, sin color ni glifos.

```
$ togi status
togi 0.1.0 · daemon activo · 4 tareas

#12  ◆ plan_review  Añadir filtro por fecha        bajo   espera tu aprobación
#13  ◐ building     Exportar promociones a CSV     medio  builder · ciclo 1/3
#11  ◑ verifying    Corregir zona horaria emails   bajo   gates 3/5
#14  ○ draft        Página de error 404            bajo   falta criterio
```

## La app de escritorio

La app de escritorio (Tauri 2) es un cliente más del daemon y usa la misma marca con otra densidad. Tiene dos modos: **banco de taller** para trabajar y **cuaderno** para decidir.

- **Banco de taller:** lista lateral de tareas agrupadas por quién tiene que actuar, la tarea seleccionada en el centro con pestañas (trayectoria, diff, ficheros, navegador, plan, log), paneles divisibles con ⌘D y paleta de comandos con ⌘K. Dos vistas globales completan la app: la mesa en vivo (⌘M) y las terminales (⌘T). Es la única superficie de togi con barra lateral.
- **Cuaderno:** al abrir una tarea en `plan_review` o `review`, la zona central pasa a la vista de lectura de la web: título en Shippori Mincho, recorrido de estados, secciones 一 二 三 y un único botón principal.
- **Densidad:** texto de interfaz a 13 / 20 px, mono a 12,5 / 20 px y filas de 32 px con puntero.
- **Sin red:** las fuentes van empaquetadas en la app, nunca cargadas de Google Fonts.
- **Referencias de uso:** Conductor, Paseo, T3 Code y Herdr. De ellas se toman patrones comunes del género (lista de trabajos con estado de atención, paneles divididos, diff, terminal, teclado); nunca su maquetación exacta, iconos ni identidad visual.

Las decisiones de arquitectura de la app están en el ADR-010 y las pantallas de referencia, en el [lienzo de la app de escritorio](https://claude.ai/artifact/QCo31vuqqDekePy6dNWcmM).

## Implementación para frontend

Los tokens se consumen como variables CSS generadas desde `tokens.json`; ningún componente escribe un hexadecimal ni un tamaño a mano.

```css
:root,
:root[data-theme="light"] {
  --bg: #F4F2ED; --surface: #FBFAF7; --border: #DEDAD2;
  --ink: #141619; --ink-muted: #5C626A;
  --human: #B4421D; --agent: #2F5F91; --done: var(--ink);
}
:root[data-theme="dark"] {
  --bg: #141619; --surface: #1D2025; --border: #2C3036;
  --ink: #E6E8EA; --ink-muted: #8B9199;
  --human: #E2622F; --agent: #6F9AC7;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* mismos valores que data-theme="dark" */ }
}
:root {
  --font-display: "Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif;
  --font-sans: "Zen Kaku Gothic New", "Hiragino Sans", system-ui, sans-serif;
  --font-mono: "M PLUS 1 Code", ui-monospace, "SF Mono", monospace;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-6: 24px; --space-8: 32px; --space-12: 48px;
  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 10px;
}
```

- **Tema:** se respeta `prefers-color-scheme` y la persona puede fijarlo con `data-theme` en `<html>`. Los dos temas son de primera clase: cada pantalla se revisa en ambos.
- **Estados:** un único módulo exporta el mapa estado → glifo, token y texto (la tabla de Estados de una tarea). Web UI y CLI lo importan del mismo paquete; la CLI imprime el carácter y las interfaces gráficas lo dibujan como SVG.
- **Monograma:** SVG en línea con `fill="currentColor"` dentro de la interfaz; los ficheros del sistema de diseño, para favicon y exportaciones.

Lista de accesibilidad antes de cada PR de interfaz:

- [ ] Contraste de texto de 4,5:1 o más en los dos temas.
- [ ] Ningún estado se comunica solo con color.
- [ ] Controles con `<button>`, `<a href>` e `<input>` con `<label>`; nada clicable sobre un `div`.
- [ ] Foco visible en todos los controles y orden de tabulación lógico.
- [ ] Áreas táctiles de 44 px o más.
- [ ] La pantalla funciona a 390 px de ancho.
- [ ] Animaciones desactivadas con `prefers-reduced-motion`.

## Qué no hacer

- Clichés japoneses: samuráis, katanas dibujadas, cerezos, olas, *torii*, caligrafía de pincel, rojo y negro de "dojo".
- Estética de producto de IA: degradados, destellos, cerebros, robots, "magia", brillos morados.
- Plantillas de panel SaaS: barras laterales de navegación genéricas (la lista de tareas de la app de escritorio es la excepción), tarjetas con sombra en rejilla, métricas sin contexto, tarjetas con borde de color a la izquierda.
- Shu y Ai como decoración, o un tercer color de acento.
- Cifras inventadas o sin fuente, en la interfaz o en el marketing.
- Emoji en la interfaz, en la CLI o en los textos de marca.
- "Togi" con mayúscula, el logotipo en otra fuente o el monograma redibujado.

## Decisiones abiertas

- [ ] **Tema principal.** El sistema de diseño dice que es el oscuro; la landing C y la pantalla de revisión "cuaderno de taller" funcionan mejor en Washi. Propuesta: claro como principal en la web UI, la documentación y la landing; oscuro como alternativa de primera clase y en las capturas de la CLI.
- [ ] **Logotipo trazado en SVG.** Convertir *togi* en Shippori Mincho a contornos para no depender de la fuente (revisar la licencia OFL de la fuente al hacerlo).
- [ ] **Colores ANSI exactos de la CLI** para `human` y `agent`, probados en los temas de terminal más comunes.
- [ ] **Set de iconos** de la web UI, si la interfaz llega a necesitarlos.
- [ ] **Validación del nombre** con un hablante nativo de japonés y búsqueda en TMview (clases 9 y 42).
- [ ] **Componentes reales** en el sistema de diseño cuando exista la web UI (botones, campos, etiqueta de estado, bloque de diff).
