# Guía de implementación y aprendizaje de NEXO

> Cómo adoptar NEXO con éxito: una organización de **empleados digitales** gobernada, que entrega resultados
> verificables. Esta guía va de lo conceptual a lo operativo, con una ruta por etapas, una lista de verificación y las
> buenas prácticas que evitan los errores típicos. Pensada para el patrocinador (dirección) y el equipo de
> implementación.

## 1. La idea en una página

NEXO no es "un chatbot": es una **plataforma para dirigir empleados digitales**. Cada agente es un empleado con:

- un **cargo** (con nivel: empleado → líder → jefe → director → gerente → superempleado),
- un **responsable humano** (titular y suplente) — sin responsable **no se puede publicar**,
- **conocimiento** autorizado, **herramientas** y **límites** de actuación,
- un **ciclo de vida** (Borrador → En validación → Publicado → Suspendido → Retirado),
- y **resultados verificables**: el trabajo se mide por **resultados aceptados**, no por mensajes enviados.

Regla rectora: *un correo enviado no es un recaudo*. Un resultado solo cuenta cuando su **contrato de resultado** está
**ACEPTADO** con evidencia, y **el que ejecuta no es el que valida**.

## 2. Principios para una implementación exitosa

1. **Empiece pequeño y real.** Un proceso, una empresa, un responsable. Nada de "automatizar todo" el primer día.
2. **Mida una línea base antes.** Tiempo y calidad del proceso **hecho a mano**, para poder demostrar el beneficio.
3. **Humano en el control de lo sensible.** Pagos, cambios de cuentas, borrados, permisos y mensajes externos pasan
   por **aprobación** hasta que cada proceso tenga su política probada.
4. **El resultado manda, no la actividad.** Defina el **contrato de resultado** y la **evidencia** antes de activar.
5. **Prefiera API/conector sobre RPA.** La RPA (y la estación virtual) es el puente para sistemas sin API, no el camino
   por defecto.
6. **Nada de credenciales en instrucciones.** Todo secreto vive en la bóveda; toda salida pasa por la pasarela.
7. **Una demo no es una aceptación.** La integración productiva la acepta el **dueño del proceso**, con datos reales.

## 3. Ruta de implementación por etapas

Alineada con el proceso piloto del documento funcional (sección 14). Cada etapa tiene una **condición de salida**.

### Etapa 0 — Descubrimiento (antes de configurar nada)
- Elija **un proceso piloto** acotado y de valor (recomendado: gestión de cartera/cobranza, o triaje de bandeja).
- Identifique **sistemas destino y accesos** (correo M365/Gmail, el sistema de negocio), **responsable humano**, volumen,
  y **datos de prueba**.
- Levante la **línea base**: ¿cuánto tiempo y con qué calidad se hace hoy, a mano?
- **Salida:** proceso elegido, accesos listados, línea base medida.

### Etapa 1 — Fundaciones
1. **Estructura empresarial** (Administración → Estructura): cree la empresa, sus **áreas**, y si aplica **líneas de
   negocio**, **sedes** y **centros de costo**. Defina **dimensiones** propias si reporta como NetSuite/SAP (Proyecto,
   Cliente, Producto…).
2. **Cargos** (Cargos): cree los cargos que necesita (p. ej. "Analista de cartera", nivel Empleado).
3. **Usuarios y roles**: invite a las personas y asígneles su rol (OWNER/ADMIN/EDITOR/VIEWER) y, cuando aplique, su
   responsabilidad de proceso.
4. **Presupuestos** (Presupuestos): fije límites por unidad/empresa para que el consumo nunca se dispare.
- **Salida:** la empresa existe, con cargos, responsables y presupuesto; las pruebas de acceso/aislamiento pasan.

### Etapa 2 — Construir el empleado digital
1. **Cree el agente** desde un cargo; asígnele **responsable titular y suplente**.
2. **Modelo**: elija `claude-opus-5-5` (o el adecuado); configure **respaldo de otro fabricante** y, si quiere,
   **enrutamiento multi-modelo** (prioriza costo/calidad/visión).
3. **Conocimiento**: cree una base, cargue los documentos/plantillas del proceso y asígnela. Active "aprender" solo si
   quiere que el agente guarde lo que descubra.
4. **Herramientas y conectores**: conecte solo lo necesario; marque las de **escritura** como "requiere aprobación".
   Defina sus **parámetros de ejecución**: si tiene **salida a internet** y si usa **estación virtual** (para RPA).
5. **Skills**: agregue instrucciones reutilizables (p. ej. "Triage de bandeja").
6. **Entrenamiento**: cargue **ejemplos** y **casos de evaluación**; corra la evaluación y apunte a la **meta de
   calidad** (≥85 %). Una prueba crítica fallida **bloquea la publicación**.
- **Salida:** el agente pasa salud + evaluación y queda listo para publicar (con responsable).

### Etapa 3 — Gobernar y poner a trabajar
1. **Políticas** (Gobierno → Políticas): defina qué acciones requieren **aprobación** (y **doble aprobación** para
   pagos/montos altos). Recuerde: el organigrama **no** concede acceso; los permisos son explícitos.
2. **Encargue trabajo** (Mi trabajo → Tareas): cree la tarea con **objetivo**, **criterio de aceptación** y
   **entregable**. Si varios agentes colaboran, use el **handoff** (un agente llega a un punto y otro continúa).
3. **Revise y acepte**: el entregable se **verifica** (verificador ≠ ejecutor) y usted **acepta o devuelve** con motivo.
4. **Vigile**: Aprobaciones, Excepciones, Supervisión y Costos. Si algo se desvía, **suspenda** (por agente/proceso/
   conector/organización) con un clic.
- **Salida:** un flujo completo, de extremo a extremo, con escritura controlada, evidencia y recuperación.

### Etapa 4 — Medir y escalar
- Lea los **indicadores de resultado**: cumplimiento, calidad, tiempo de ciclo, **costo por resultado**, excepciones,
  **beneficio validado** (separado de las estimaciones).
- Compare contra la **línea base** de la Etapa 0. Si el beneficio es real y aceptado por el dueño del proceso, **escale**
  a un segundo proceso reutilizando lo construido.

## 4. Cómo aprender la plataforma (ruta corta)

1. **Pruebe un agente** ya existente en "Probar agente" (chat): observe las pestañas **Conversación / Actividad /
   Diagnóstico** — ahí ve qué consultó, qué herramienta usó y por qué.
2. **Cree un cargo y un agente** pequeño con un solo objetivo y conocimiento mínimo.
3. **Déle una tarea** con criterio de aceptación y vea el ciclo **resultado generado → verificado → aceptado**.
4. **Fuerce una aprobación**: configure una política que exija aprobación para una acción y apruébela en la bandeja.
5. **Mire los costos** en Mi consumo y la **consola de análisis** por dimensión.
6. **Rompa algo a propósito** (una tarea bloqueada) y recupérela desde **Excepciones**.

Con esos 6 pasos entiende el 80 % del modelo: empleado → tarea → resultado verificado → gobierno → costo → recuperación.

## 5. Lista de verificación de "listo para producción"

- [ ] El agente tiene **cargo** y **responsable** (titular y suplente).
- [ ] Conocimiento **con fuentes** y permisos correctos; cita documento al responder.
- [ ] Herramientas de escritura marcadas como **requieren aprobación**; sin credenciales en instrucciones.
- [ ] Parámetros de ejecución definidos: **internet** sí/no, **estación virtual** sí/no, horario, presupuesto.
- [ ] **Casos de evaluación** ≥ 5 y evaluación ≥ meta; prueba crítica en verde.
- [ ] **Política** del proceso aprobada; acciones sensibles con aprobación (doble donde aplique).
- [ ] **Contrato de resultado** con evidencia exigida; verificador ≠ ejecutor.
- [ ] **Presupuesto** y alertas configurados; costo por resultado visible.
- [ ] **Suspensión** probada (sé cómo parar al agente o a toda la operación).
- [ ] **Aislamiento** verificado: una empresa no ve datos de otra.

## 6. Errores típicos a evitar

- Publicar un agente **sin responsable** o sin pruebas (no se podrá, y está bien que así sea).
- Confundir **actividad con resultado** (número de mensajes ≠ trabajo hecho).
- Dar herramientas de **escritura sin aprobación** "para ir rápido".
- Dejar que un agente **se apruebe a sí mismo** o **amplíe su presupuesto** por instrucción generada (está bloqueado).
- Automatizar comunicaciones externas **antes** de validar la política del proceso.
- Usar **RPA** donde hay API disponible.
- Saltarse la **línea base**: sin ella no se puede demostrar beneficio.

## 7. Piloto recomendado (cartera)

Una empresa, una fuente de facturas, un responsable de Tesorería. El agente consulta diariamente los documentos
próximos a vencer, valida cliente y estado, detecta inconsistencias y **prepara** las gestiones; un revisor verifica y
Tesorería **aprueba** las comunicaciones. Se registra envío, resultado e incidencias — **sin dar por recaudado** por
haber enviado un correo. Casos a cubrir: factura válida, factura pagada, datos inconsistentes, contacto ausente,
duplicado, fuente no disponible, mensaje rechazado, aprobación vencida y respuesta externa incierta.

**Criterio de éxito:** procesar un conjunto representativo con trazabilidad completa, sin accesos indebidos ni acciones
duplicadas, con aprobación válida cuando aplica y costo visible; el dueño del proceso **acepta** los entregables y
compara calidad/tiempo con la línea base.

## 8. Dónde está cada cosa en la app

| Quiero… | Voy a… |
|---|---|
| Ver el estado general | **Inicio** |
| Lo que me toca hoy | **Mi trabajo** (tareas, revisiones, aprobaciones, bloqueos) |
| Crear/organizar empleados | **Agentes**, **Cargos** |
| Armar la empresa | **Organización → Estructura**, **Dimensiones** |
| Conocimiento y conexiones | **Conocimiento**, **Conectores**, **Apps conectadas** |
| Gobernar acciones | **Gobierno → Políticas / Aprobaciones / Suspensión** |
| Recuperar fallos | **Excepciones** |
| Ver plata | **Costos**, **Presupuestos**, **Mi consumo**, consola de análisis |

> Esta guía describe el modelo y la ruta. A medida que se completen las consolas gerenciales, la comunidad interna y los
> canales externos (correo/WhatsApp/voz), se añadirán sus secciones aquí.
