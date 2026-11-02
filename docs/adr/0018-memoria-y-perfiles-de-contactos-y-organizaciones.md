# 0018. Memoria operativa y perfiles de contactos y organizaciones

- **Estado:** Propuesto — **construcción pendiente de autorización del patrocinador.**
- **Fecha:** 2026-11-02
- **Responsables:** nexo-architect, nexo-backend-ai, nexo-backend-platform
- **Relacionado:**
  - ADR 0004 (bucle de mejora supervisada: el aprendizaje cambia versiones **con revisión humana**, módulo `training`).
  - ADR 0008 (protección de datos y observabilidad: privacidad y retención de conversaciones, `data-protection`).
  - ADR 0015 (canales externos correo/WhatsApp/voz; `modules/channels`, en sandbox).
  - ADR 0012 (trabajo por resultados: el contexto del contacto/organización nutre la gestión, no concede permisos).
  - Conocimiento/RAG (`modules/knowledge`): memoria **documental**; este ADR agrega memoria **relacional y operativa**.
  - Auditoría inmutable (`modules/audit`) y gobierno de acciones (ADR 0013).

## Contexto

El patrocinador detectó dos ausencias reales:

1. **El agente no aprende de sus propios procesamientos de forma acumulativa.** Hoy el aprendizaje es **supervisado y
   manual** (`training`: 👍/👎 → casos → evaluación → nueva versión), lo cual es correcto por gobierno, pero **no existe
   una memoria operativa** que conserve lo aprendido por proceso (preferencias, excepciones frecuentes, acuerdos).
2. **No hay perfilado de correspondentes ni de organizaciones.** Cuando un agente atiende un buzón, **no construye** una
   ficha de *la persona que escribe* ni de *la organización* con la que trata. El agente "responde correos" pero **no
   conoce a quién le escribe**.

Es una brecha de valor: un empleado digital que recuerda a sus contrapartes y aprende de cada interacción es claramente
superior. Debe hacerse **gobernado** (con fuente, caducidad, auditable, multi-tenant y respetando privacidad/retención),
nunca como aprendizaje automático sin control.

## Alternativas consideradas

1. **Seguir solo con RAG/conocimiento estático** — insuficiente: el conocimiento documental no modela a la persona ni a
   la organización ni acumula hechos operativos por proceso. Rechazada.
2. **Módulo de memoria y perfiles gobernado** (persona + organización + memoria operativa por proceso), enganchado a los
   canales (correo primero) y usado como **contexto** del agente. Ventaja: cierra la brecha con control. **Elegida.**
3. **Aprendizaje automático sin supervisión** (que el agente escriba su propia memoria/versión sin control) — viola el
   gobierno (nada cambia sin aprobación humana) y el principio de trazabilidad. Rechazada.

## Decisión

Crear un **módulo `profiles` (memoria operativa y perfiles)** con tres tipos de dato gobernados y multi-tenant:

- **Perfil de contacto (persona):** identidad (nombre, correos/teléfonos), idioma y tono, historial de interacciones,
  compromisos y resultados previos, señales derivadas (p. ej. puntualidad de pago) — **con fuente y evidencia**.
- **Perfil de organización:** dominio, tipo/sector, contactos vinculados, acuerdos e historial (cartera/incidencias).
- **Memoria operativa por proceso:** hechos reutilizables aprendidos (preferencias, excepciones frecuentes), **cada uno
  con fuente, caducidad y estado** (propuesto/confirmado), auditable.

Principios: los perfiles y la memoria son **contexto**, **no permisos** (no amplían lo que el agente puede hacer); se
enriquecen desde los canales (correo) de forma **idempotente**; respetan **privacidad y retención** (ADR 0008) y el
**derecho al olvido**; los datos personales se clasifican y protegen. El agente los recibe como contexto compacto.

## Consecuencias

- **Datos:** migración **aditiva** — nuevas tablas `ContactoPerfil`, `OrganizacionPerfil`, `MemoriaOperativa` (y enlaces),
  todas con `workspaceId`. PII cifrada/clasificada; políticas de retención y purga; índices para búsqueda por correo/dominio.
- **API/Frontend:** fichas de **contacto** y **organización**, y su vista desde el buzón (`modules/channels`); edición y
  depuración gobernadas por rol.
- **Seguridad:** PII bajo protección de datos; aislamiento estricto por workspace; auditoría de lectura/escritura de
  perfiles; sin credenciales ni secretos en perfiles.
- **Rendimiento:** el perfil se inyecta como **contexto compacto** (se alinea con ADR 0017: resumen, no volcado); índices
  para enriquecer en entrada sin penalizar.
- **Plan de pruebas:** enriquecimiento idempotente desde correo; aislamiento multi-tenant; retención/olvido efectivos;
  que el contexto de perfil mejore la gestión **sin** conceder permisos nuevos.

## Plan de implementación

| Tarea | Dueño | Criterio de aceptación |
|---|---|---|
| Inc.1 Esquema + servicio de perfiles (persona/organización) + API (CRUD gobernado) | nexo-backend-platform | Perfiles multi-tenant, con fuente y retención; aislamiento verificado; PII protegida. |
| Inc.2 Enganche con canal de correo: enriquecer perfil en cada entrada + usar como contexto del agente | nexo-backend-ai | Enriquecimiento idempotente; el agente recibe contexto del contacto/organización; no cambia permisos. |
| Inc.3 Memoria operativa por proceso (hechos con fuente/caducidad/estado) | nexo-backend-ai | Hechos gobernados y auditables; caducan; no alteran la versión del agente sin revisión (ADR 0004). |
| Inc.4 UI: ficha de contacto y de organización en el buzón | nexo-frontend-ui | Vista clara de persona/organización e historial; edición por rol; respeta privacidad. |
| Pruebas de privacidad, aislamiento y olvido | nexo-qa-api | Retención y derecho al olvido efectivos; ningún dato cruza de workspace. |
