# 0019. Agent Hub — plantillas gobernadas de empleados digitales (marketplace interno)

- **Estado:** Propuesto — **construcción autorizada por el patrocinador (2026-11-02)**, por incrementos validados.
- **Fecha:** 2026-11-02
- **Responsables:** nexo-architect, nexo-backend-platform, nexo-frontend-ui
- **Relacionado:**
  - ADR 0005 (catálogo de integraciones versionado en código — patrón de "instalar" que crea objetos y secretos).
  - ADR 0007 (visibilidad y permisos; mencionar/compartir **no** concede acceso; permisos explícitos).
  - ADR 0009 (publicación de versiones) y versiones de agente (`AgentVersion`).
  - ADR 0011/0014 (empleado digital: `Cargo`, responsable obligatorio; **Cuadrillas** gobernadas).
  - ADR 0016 (`AGENTE_NO_CREA_AGENTES`: un agente no crea empleados digitales por su cuenta — el hub lo opera una **persona**).
  - Referencia externa: AIOS *Agent Hub* / Cerebrum (publicar, versionar y descubrir agentes).

## Contexto

Implantar NEXO en varias empresas/clientes implica **reconstruir** empleados digitales y cuadrillas parecidos una y otra
vez. Hoy existen piezas reutilizables (catálogo de integraciones, skills, versiones de agente) pero **no** un lugar para
**publicar, versionar, descubrir e instalar** plantillas gobernadas de empleados digitales y cuadrillas. Un "Agent Hub"
interno acelera implantaciones, estandariza buenas prácticas y abre una **línea de producto** (marketplace de empleados
digitales), sin sacrificar el gobierno.

Restricción rectora: una plantilla es **configuración reutilizable**, nunca credenciales ni permisos. Instalar una
plantilla **no** concede accesos ni publica el agente; crea un borrador que una persona completa (responsable, secretos
por bóveda, pruebas) antes de lanzar.

## Alternativas consideradas

1. **Copiar agentes a mano** entre workspaces — lento, propenso a error, sin versionado ni trazabilidad. Rechazada.
2. **Hub interno de plantillas gobernadas** (publicar/versionar/descubrir/instalar dentro de la organización o entre
   workspaces permitidos) — reutiliza el patrón "instalar" del catálogo (ADR 0005) con gobierno. **Elegida.**
3. **Hub público estilo marketplace abierto** (subir/descargar de terceros) — implicaciones de seguridad, confianza y
   negocio que exceden el alcance actual. **Diferida** (posible evolución P2).

## Decisión

Crear un **Agent Hub** con **plantillas versionadas**:

- **Plantilla de empleado digital (`AgentTemplate` + `AgentTemplateVersion`):** empaqueta cargo base, perfil/prompt,
  skills, referencias de conocimiento (no el contenido sensible), operaciones requeridas (por capacidad, no por conector
  concreto) y parámetros de ejecución recomendados. **Sin secretos, sin responsable, sin credenciales.**
- **Plantilla de cuadrilla (`CrewTemplate`):** composición gobernada de varios cargos/plantillas (ADR 0014).
- **Publicar:** una persona con rol suficiente publica una versión a partir de un agente/cuadrilla existente; queda
  **auditada**.
- **Descubrir:** galería filtrable (por área, proceso, nivel) dentro de la organización.
- **Instalar:** crea un **borrador** de agente/cuadrilla en el workspace destino; exige **responsable** y reconfiguración
  de secretos por **bóveda** antes de lanzar; no concede accesos ni visibilidad por sí mismo.

## Consecuencias

- **Datos:** migración **aditiva** — `AgentTemplate`, `AgentTemplateVersion`, `CrewTemplate` (y enlaces), con ámbito
  **workspace/organización**. Ningún secreto se persiste en la plantilla.
- **API/Frontend:** publicar / explorar / instalar; galería del hub; vista de versiones y diferencias.
- **Seguridad:** sin credenciales en plantillas; aislamiento (una plantilla solo es visible donde se autoriza);
  **auditoría** de publicación e instalación; instalar respeta `AGENTE_NO_CREA_AGENTES` (lo opera una persona).
- **Rendimiento:** impacto bajo; publicar/instalar son operaciones puntuales.
- **Plan de pruebas:** instalar produce un agente **válido pero en borrador** (sin responsable → no se puede lanzar);
  ningún secreto viaja en la plantilla; aislamiento entre workspaces; versiones y diferencias correctas.

## Plan de implementación

| Tarea | Dueño | Criterio de aceptación |
|---|---|---|
| Inc.1 Esquema + publicar e instalar **plantilla de agente** (API) | nexo-backend-platform | Publicar desde un agente; instalar crea borrador con responsable pendiente; sin secretos; auditado; aislado. |
| Inc.2 Galería del hub + versiones y diferencias (web) | nexo-frontend-ui | Explorar/filtrar, ver versiones, instalar desde la UI; estados claros. |
| Inc.3 **Plantillas de cuadrilla** (ADR 0014) | nexo-backend-platform | Publicar/instalar cuadrillas con composición gobernada; validación de composición. |
| Inc.4 (futuro, diferido) Distribución entre organizaciones | nexo-architect | Modelo de confianza/seguridad definido antes de construir. |
