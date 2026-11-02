# 0017. Rendimiento y reutilización de contexto de los agentes

- **Estado:** Propuesto — **construcción pendiente de autorización del patrocinador.**
- **Fecha:** 2026-11-02
- **Responsables:** nexo-architect, nexo-backend-ai
- **Relacionado:**
  - ADR 0002 (gobierno de IA multi-LLM y presupuestos: `LlmGatewayService`, `assertCanSpend`, `UsageRecord`).
  - ADR 0010 (orquestación multi-modelo activa; traza de rol/razón en `UsageRecord`).
  - Runtime de agentes (`AgentRuntimeService`, `LlmClient`): bucle de tool use con streaming, thinking adaptativo,
    ejecución paralela de tools, historial **append-only en formato nativo del proveedor**.
  - Workers BullMQ (colas `workflows`, `routines`, `evals`).
  - Referencia externa: AIOS (LLM Agent Operating System) — *agent scheduler* + *context manager* reportan ~2.1× con
    agentes concurrentes. Se adoptan las **ideas** (reutilización de contexto, programación consciente), no un kernel propio.

## Contexto

A medida que crezca el número de agentes concurrentes y la longitud de los hilos, NEXO se castiga en **costo** (tokens de
entrada repetidos: el *system prompt*, el conocimiento y el historial se re-envían completos en cada turno) y en
**latencia**. Hoy la ejecución es correcta pero no está optimizada para escala: las colas son FIFO sin límites por
inquilino y no hay reutilización de contexto entre turnos. El problema es **futuro y acumulativo**: cuanto más éxito
tenga la plataforma, más se nota.

Restricciones que no se pueden romper: el historial debe seguir **append-only en formato nativo del proveedor** (no
alterar bloques de razonamiento; respetar *preserved thinking*), todo gasto pasa por el gobierno de costos, y el
aislamiento multi-tenant es inviolable.

## Alternativas consideradas

1. **No hacer nada** — simple hoy, caro y lento mañana; riesgo de sorpresa de factura y de SLA al escalar. Rechazada.
2. **Reutilización de contexto + memoria compacta + programación consciente (incremental)** — usa capacidades del
   proveedor (prompt caching) y mejoras de cola sin reescribir el runtime. Ventaja: bajo riesgo, medible, reversible.
   **Elegida.**
3. **Kernel de agentes propio tipo AIOS** (syscalls, scheduler y context manager a nivel sistema) — sobre-ingeniería para
   el valor que NEXO necesita; gran costo y riesgo. Rechazada (se revisará solo si la escala lo exige).

## Decisión

Adoptar la **Opción 2** en tres incrementos medibles, cada uno con *benchmark* antes/después y sin cambiar el
comportamiento funcional del agente:

- **Inc.1 — Reutilización de contexto (prompt caching).** Cachear el bloque estable del agente (system prompt +
  conocimiento/plantillas que no cambian entre turnos) para reducir tokens de entrada y latencia. El cache respeta el
  aislamiento por workspace/agente y **nunca** cachea secretos.
- **Inc.2 — Memoria de corto plazo compacta.** Resumen incremental del hilo para no recargar todo el historial cada
  turno, preservando el formato nativo y los bloques de razonamiento (el resumen es contexto adicional, no reemplaza el
  historial auditable).
- **Inc.3 — Programación consciente de concurrencia.** Límites de concurrencia por workspace/agente en las colas y
  prioridad por costo/urgencia (hoy FIFO); **presupuesto de latencia/tokens por turno** registrado junto al costo.

## Consecuencias

- **Datos:** migración **aditiva** menor — métricas de latencia en `UsageRecord` y, para Inc.2, almacenamiento del
  resumen de hilo. Sin romper flujos guardados.
- **API/Frontend:** exponer latencia y ahorro de tokens en analítica/consumo; sin cambios de contrato obligatorios.
- **Seguridad:** el cache y el resumen heredan el aislamiento y la clasificación de datos; secretos nunca entran al cache.
- **Rendimiento y escalabilidad:** metas objetivo a validar — reducción de **tokens de entrada** y de **latencia p50** en
  hilos largos; throughput estable al crecer la concurrencia. Cada incremento se acepta solo si el *benchmark* lo prueba.
- **Plan de pruebas:** *benchmark* reproducible (hilo corto/largo, 1/N agentes) que mida tokens, costo y latencia
  antes/después; pruebas de que el gobierno de costos sigue aplicando y de que el aislamiento no se filtra por el cache.

## Plan de implementación

| Tarea | Dueño | Criterio de aceptación |
|---|---|---|
| Inc.1 Prompt caching del bloque estable del agente | nexo-backend-ai | Reducción medible de tokens de entrada y latencia en hilos repetidos; sin fuga de secretos; gobierno de costos intacto. |
| Inc.2 Resumen incremental del hilo (memoria compacta) | nexo-backend-ai | Historial sigue append-only y auditable; menos recarga por turno; calidad de respuesta no cae en la evaluación. |
| Inc.3 Scheduler con límites y prioridad + presupuesto de latencia | nexo-backend-platform | Límites por workspace/agente efectivos; prioridad por costo/urgencia; latencia registrada en `UsageRecord`. |
| Benchmark antes/después | nexo-qa-api | Informe reproducible con tokens/costo/latencia y throughput por nivel de concurrencia. |
