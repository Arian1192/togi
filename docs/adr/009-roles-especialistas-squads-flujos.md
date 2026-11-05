# ADR-009: Roles, especialistas, squads y flujos configurables

5 de noviembre de 2026 · Arian

Decisión: los agentes aportan el contenido, y el recorrido lo decide togi con reglas que cada usuario compone; nunca un agente. Estado: **aprobado el 5 de noviembre de 2026**.

Los diagramas de este ADR están en su [documento original](https://claude.ai/artifact/Mp8t12DzoL52BPKhyhrahz).

## Estado y contexto

La rebanada 2 trae el primer agente, un planificador. Pero togi no debe servir solo para una forma de trabajar: cada persona querrá sus propios agentes (un analista, un experto en marketing, un ingeniero senior), agrupados como prefiera, y con su propio recorrido. Y algunos equipos querrán que ciertos agentes no puedan hablar entre ellos.

Hay que decidirlo antes del PR 15, que crea el primer especialista, `generic-planner@1`. Si ese especialista se escribe a fuego en el código, añadir el segundo obligará a rehacerlo. Si se escribe como el primero de un catálogo, los siguientes serán datos.

La pregunta central no es cómo crear agentes, sino **quién decide a quién le llega cada trabajo**: si un plan pasa primero por el experto en marketing, si va directo al constructor o si vuelve al planificador porque algo no cuadra.

## El modelo en cinco capas

*Diagrama: el modelo en cinco capas, en el documento original.*

| Capa | Qué es | Quién la define |
| --- | --- | --- |
| Garantías de togi | Tus aprobaciones, el sandbox, los tests intocables, los bucles con límite | Fijo |
| Flujo | Quién participa en cada etapa y qué pasa con su veredicto | El usuario |
| Squads | Agrupan especialistas, les ponen un techo y filtran qué información reciben | El usuario |
| Especialistas | Perfiles con instrucciones, herramientas y modelo, versionados | El usuario |
| Roles | Productores y evaluadores: la lista cerrada que fija el poder de cada agente | Fijo, cambia con un ADR |

Las dos capas de los extremos las fija togi: las garantías, que nadie configura, y los roles, que solo cambian con un ADR. Las tres del medio las compone cada usuario. Así togi se adapta a cualquier forma de trabajar sin que ninguna configuración pueda dar a un agente más poder del que permite su rol.

## Roles: la lista cerrada que fija el poder

Un rol es un puesto del flujo: qué recibe, qué produce y qué nunca puede hacer. Los roles son una lista cerrada en `core`, porque el rol es lo que decide el poder de un agente. Añadir uno exige un ADR.

Hay dos familias:

- **Productores:** hacen el trabajo de una etapa y producen su entregable. Hay uno por etapa.
- **Evaluadores:** opinan sobre un entregable en un punto de enganche y emiten un veredicto. Nunca cambian el estado de la tarea ni el entregable.

| Rol | Familia | Recibe | Produce | Nunca puede |
| --- | --- | --- | --- | --- |
| Analista *(nuevo)* | Productor, etapa de especificación | Una idea | Una propuesta de especificación | Enviar la tarea sin tu aprobación |
| Planificador | Productor, etapa de planificación | La tarea y el repo | Un plan | Aprobar su plan, escribir código |
| Constructor | Productor, etapa de construcción | El plan y el informe de la ronda | Un cambio de código | Tocar tests, gates o credenciales |
| Consultor *(nuevo)* | Evaluador | Un entregable | Un informe y un veredicto | Escribir código, decidir |
| Revisor | Evaluador | El cambio y el plan | Hallazgos y un veredicto | Decidir de forma vinculante |

Un evaluador emite uno de tres veredictos: `ok`, `concerns` (dudas, sin bloquear) o `blocking`. Qué pasa con cada uno no lo decide el evaluador, sino la política del flujo.

## Especialistas: perfiles libres, como datos

Un especialista es quien ocupa un rol: con qué instrucciones, herramientas y modelo trabaja. El usuario crea los que quiera, como ficheros de datos, sin tocar código.

```yaml
id: marketing-consultant
version: 1
role: consultant
runtime: claude-agent-sdk
model: claude-sonnet-5-5
tools: [read, search]
instructions: |
  Eres un experto en marketing de producto. Revisa los textos y la
  estructura de las páginas orientadas al cliente. Señala problemas de
  claridad, tono y conversión. No propongas cambios de código.
```

- **El rol limita al especialista.** Un especialista no puede pedir herramientas que su rol no admita: un consultor con permiso de escritura se rechaza al publicarlo.
- **Cada versión es inmutable** (ADR-004). Al publicarlo, togi registra `specialist.version_published` con el hash de su contenido. Cambiar las instrucciones crea la versión 2.
- **Cada sesión registra su especialista y su versión.** Así se puede medir, por especialista, cuántos planes se aprueban a la primera o cuántas rondas necesitan.
- **El runtime es una opción del especialista.** Un especialista puede usar Claude por el Agent SDK y otro Codex por ACP (ADR-003 y ADR-008).

## Squads y guardrails

Una squad es un equipo con nombre: agrupa especialistas, dice en qué etapas participa y les pone un techo común de permisos y de presupuesto. Ningún miembro puede tener más acceso que su squad.

*Diagrama: tres squads de ejemplo, con los entregables que cruzan y los que no, en el documento original.*

Como toda comunicación pasa por el daemon, togi aplica entre squads una **matriz de guardrails**: por defecto no pasa nada, y solo cruzan los entregables acordados. Esto sirve para:

- **Revisiones independientes.** La squad de calidad recibe el plan y el cambio, pero no las explicaciones del constructor, que la inclinarían a darle la razón.
- **Entregas limpias.** La implementación recibe la especificación que aprobaste, no el debate interno de producto con sus ideas descartadas.
- **Contener una manipulación.** Un agente que lea algo malicioso solo influye en lo que entrega su squad, y ese entregable pasa por las reglas y por ti.

Es la separación de funciones de cualquier organización: quien hace algo no es quien lo revisa, y cada equipo recibe lo que necesita para su trabajo.

```yaml
squads:
  producto:
    members: [analyst@1, marketing-consultant@1, ux-expert@1]
    participates_in: [specification, plan_review]
    max_tools: [read, search]
  implementacion:
    members: [senior-planner@2, generic-builder@1]
    participates_in: [planning, building]
  calidad:
    members: [security-reviewer@3, senior-engineer@1]
    participates_in: [review]
handoffs:
  producto -> implementacion: [approved_spec]
  implementacion -> calidad: [plan, diff]
```

## Flujos configurables

El recorrido se decide con reglas, nunca por un agente. Las etapas son siempre las mismas (ADR-001); lo que cada usuario compone es quién produce cada etapa y qué evaluadores se enganchan entre ellas.

*Diagrama: etapas fijas, productores y puntos de enganche configurables, en el documento original.*

Puntos de enganche: `before_plan_review` (entre la planificación y tu aprobación del plan), `after_build` (entre la construcción y la verificación) y `before_pr_review` (antes de tu revisión del PR).

Tres decisiones, todas deterministas:

1. **Las etapas** las fija el decider de `core`. Un agente no puede saltarse ni inventar una.
2. **Quién participa** lo deciden las reglas `when` de cada enganche: la etapa, los ficheros que toca el plan, el riesgo o el repo. Mismo plan, mismo resultado.
3. **Qué pasa con cada veredicto** lo decide la política del enganche:

| Política | Qué hace togi |
| --- | --- |
| `attach` | Une el informe al entregable y sigue. Es la política por defecto para `ok` y `concerns` |
| `return_to_producer` | Devuelve el entregable al productor con el informe, hasta `max_returns` veces; al agotarlas, llega a ti |
| `notify_human` | Sigue, pero marca la tarea como pendiente de tu atención con el informe |

Un agente puede **sugerir** participantes, por ejemplo marcar en su plan que toca textos de cara al cliente, y una regla puede usar esa marca para añadir una consulta. Una sugerencia solo añade, nunca quita a quien exigen las reglas.

```yaml
stages:
  planning:
    producer: senior-planner@2
  plan_review:
    evaluators:
      - specialist: marketing-consultant@1
        when: { paths: ["src/pages/**"] }
        on_blocking: return_to_producer
    max_returns: 2
```

Quien no configure nada usa el flujo por defecto: un productor por etapa y ningún evaluador.

## Lo que togi garantiza siempre

Ninguna configuración puede cambiar estas reglas. Las aplica el decider de `core` y el daemon, por encima de cualquier flujo, squad o especialista:

1. **Tú apruebas el plan**, y el merge según la política de riesgo del ADR-001. Ningún agente aprueba.
2. **Ningún agente toca los tests, los gates, sus credenciales ni la configuración del flujo** (principio 4).
3. **Todo agente trabaja en el sandbox del ADR-008**, con los límites de su rol y de su squad.
4. **Los agentes nunca se conectan entre sí:** toda comunicación pasa por el daemon (ADR-008, punto 5).
5. **Ningún bucle es infinito:** cada vuelta atrás tiene un máximo, y al agotarlo la decisión llega a ti.
6. **Todo queda en el log:** cada sesión registra su especialista, su squad y la versión del flujo que la lanzó.

Un cambio necesario para este ADR: hoy solo un humano puede devolver un plan (`requestPlanChanges`, PR 2). Para que un veredicto bloqueante lo devuelva, el actor `system` también podrá hacerlo, solo cuando lo ordene la política del flujo y dentro de su máximo de vueltas. Aprobar sigue siendo exclusivamente humano.

## Dónde vive la configuración

La configuración de especialistas, squads y flujos vive **en togi, fuera del repo**, asociada al repo registrado (PR 7). Se publica con la CLI y queda versionada como eventos, igual que los especialistas.

La alternativa natural, un fichero dentro del repo como el de GitHub Actions, se descarta: un constructor podría modificarlo en su propio PR y quitar al revisor de seguridad de su flujo. Si algún día conviene tenerla en el repo, será una ruta protegida por el gate `test_integrity`, que ningún agente puede tocar.

Togi valida la configuración antes de aceptarla:

- Cada especialista existe y su rol encaja con el punto donde se usa.
- Ningún especialista supera el techo de permisos de su squad.
- Cada vuelta atrás tiene un máximo.
- Los entregables que cruzan entre squads están permitidos por la matriz de guardrails.

Una configuración que no pasa la validación se rechaza entera, y sigue vigente la anterior.

## Ejemplo de funcionamiento

Una tarea real, de principio a fin, con la configuración de las secciones anteriores: tres squads, un consultor de marketing enganchado antes de tu revisión del plan y un revisor de seguridad.

*Diagrama: el ejemplo completo, quince pasos por cinco carriles, en el documento original.*

1. Escribes una idea: *mejorar la conversión de la página de precios*.
2. La etapa de especificación corresponde a la squad de producto: el analista propone qué cambiar y cómo medirlo.
3. Apruebas la especificación, o la corriges.
4. Togi entrega a implementación **solo la especificación aprobada**: el debate interno de producto no cruza.
5. El planificador senior propone el plan v1.
6. La regla del enganche `before_plan_review` se cumple, porque el plan toca `src/pages/`: togi pide la consulta de marketing.
7. El consultor de marketing emite un veredicto bloqueante: el precio anual no se ve en móvil.
8. La política `return_to_producer` devuelve el plan al planificador con el informe. Es la vuelta 1 de 2.
9. El planificador propone el plan v2, teniendo en cuenta el informe.
10. Marketing vuelve a revisarlo: sin objeciones.
11. Apruebas el plan v2, leyendo el plan y los dos informes de marketing.
12. El constructor implementa en su sandbox, con sus rondas si los gates fallan.
13. Los gates pasan, y togi entrega a calidad **el plan y el cambio**, sin las explicaciones del constructor.
14. El revisor de seguridad no encuentra nada.
15. Decides el merge.

En ningún paso un agente decide el recorrido ni habla con otro: todo pasa por togi, que aplica las reglas, registra cada paso en el log y te deja las tres decisiones. Si en el paso 10 marketing hubiera vuelto a bloquear, el plan habría vuelto otra vez; a la tercera, te habría llegado igualmente, con los informes, para que decidas tú.

## Alternativas descartadas

| Alternativa | Por qué se descarta |
| --- | --- |
| Un agente director que decide a quién pasar cada trabajo | Se puede manipular con el contenido de la tarea o del repo, no es repetible y es difícil de auditar. Los agentes pueden **sugerir** añadir participantes, nunca quitar los que exigen las reglas. |
| Agentes que hablan directamente entre sí, por A2A u otro canal | Haría imposibles los guardrails entre squads y la trazabilidad, y abriría la red del sandbox (ADR-008). |
| Roles libres, que cada usuario define | El rol fija el poder de un agente: un rol inventado podría darse permisos de más. Los especialistas sí son libres. |
| Recorrido fijo, igual para todos | No se adapta a quien quiere más agentes ni a quien quiere menos. |
| Configuración dentro del repo | Un agente podría modificar su propio flujo en un PR (principio 4). |

## Consecuencias y cuándo se construye

Este ADR no adelanta trabajo a la rebanada 2. Cambia cómo se construyen dos piezas que ya están en el plan:

- **PR 15:** `generic-planner@1` se publica como el primer especialista de un catálogo: su formato es un esquema en `core`, con su rol, y se registra con `specialist.version_published`.
- **PR 16:** el orquestador lee el recorrido de una configuración, aunque de momento solo exista la de por defecto: un planificador, sin evaluadores.

Lo demás llega por partes:

| Rebanada | Qué se añade |
| --- | --- |
| 3 | El rol de constructor como productor configurable; los evaluadores en el punto `after_build`, con la política de veredictos |
| 4 | El rol de consultor, los evaluadores en `before_plan_review` y `before_pr_review`, y el revisor en modo sombra |
| Después del piloto | Las squads y la matriz de guardrails; el rol de analista y la etapa de especificación |

Riesgos:

- **Configuraciones complejas difíciles de entender.** Mitigación: `togi workflow show` dibuja el recorrido de una tarea antes de lanzarla.
- **Coste:** cada evaluador es una sesión más. Mitigación: un presupuesto por squad y por tarea.

Pendiente de decidir antes de la rebanada 4: el formato exacto de la configuración y los comandos para publicarla.
