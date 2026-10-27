# Ficha definitiva — Piloto de cobranza (sandbox, datos sintéticos)

> **Propósito:** definir el alcance y los criterios de aceptación del piloto de cobranza para su **validación** por el
> patrocinador. **Estado:** preparación en **sandbox**. No contacta clientes reales, no envía correos/WhatsApp reales y
> no modifica sistemas productivos. La construcción del piloto (seed de datos sintéticos + recorrido) procede bajo la
> autorización de **construir** del 2026-10-27; **activación real y gasto quedan fuera** y requieren autorización aparte.

## 1. Objetivo del piloto

Demostrar, de extremo a extremo y de forma gobernada, que un equipo de empleados digitales puede llevar una gestión de
cobranza desde la **asignación** del trabajo hasta la **evidencia verificable del resultado**, respetando el principio
de NEXO: *un correo enviado no cuenta como recaudo; solo cuenta el **contrato de resultado ACEPTADO***.

## 2. Alcance

**Incluye (en sandbox):**
- Una **empresa sintética** con una cartera de clientes ficticios y facturas vencidas (datos generados, sin PII real).
- Empleados digitales de cobranza (gestor) y un verificador distinto del ejecutor.
- El ciclo de trabajo por resultados (E4): objetivo → tarea con criterio de aceptación → ejecución → verificación →
  aceptación/devolución → **Pasaporte de resultado** (ADR 0014).
- Comunicación por canal **simulado** (correo/WhatsApp en modo `SIMULADO`, sin envíos reales) y conversión de un hilo en
  **tarea autorizada** (E5).
- Acciones con impacto económico (p. ej. registrar un acuerdo de pago/aplicar un descuento) sujetas a **aprobación
  humana** (E6); en el piloto, **doble aprobación** por defecto para pagos/transferencias.

**Excluye (queda fuera del piloto):**
- Clientes, correos, números o cuentas **reales**; cualquier envío real (correo/WhatsApp/voz).
- Integración con sistemas productivos (ERP/CRM/pasarelas de pago reales).
- Ejecución monetaria autónoma: no hay movimiento de dinero; los montos/umbrales reales los define Finanzas (pto 5).
- Afirmaciones de cumplimiento regulatorio o valor probatorio (Cumplimiento/Jurídica pendientes, ptos 6-7).

## 3. Datos sintéticos

- Cartera generada con nombres, identificadores, montos y fechas **ficticios**; marcados como `sandbox`/sintéticos.
- Sin datos personales reales. La grabación de voz permanece **desactivada** (`GrabacionConfig` off por defecto).
- Los canales usan el adaptador `SIMULADO` (determinista); ninguna credencial real se carga.

## 4. Actores

| Actor | Tipo | Rol en el piloto |
|---|---|---|
| Dueño de cartera | **Humano** | Patrocina el objetivo, autoriza acciones sensibles, acepta/devuelve resultados. |
| Gestor de cobranza | Empleado digital | Ejecuta la gestión (contacto simulado, propuesta de acuerdo), **no se autoverifica**. |
| Verificador | Empleado digital o humano | Verifica el resultado (verificador ≠ ejecutor). |
| (Opcional) Coordinador | Superempleado (Inc.1) | Seguimiento de compromisos, detección de bloqueos y escalamiento (sin ejecutar ni autoaprobar). |

## 5. Flujo del resultado (lo que el piloto debe demostrar)

1. **Asignación:** el dueño (o el coordinador que **propone** y el dueño autoriza) crea un **objetivo** y **tareas** con
   **criterio de aceptación** y entregable esperado; se asignan al gestor (vía `MensajeAgente` de ASIGNACION, E5).
2. **Ejecución:** el gestor trabaja la tarea; el contacto con el cliente es **simulado**; toda acción con impacto
   (acuerdo de pago, descuento) se detiene en la **bandeja de aprobaciones** (doble aprobación humana).
3. **Revisión:** un **verificador distinto** comprueba el resultado contra el criterio de aceptación (E4).
4. **Aprobación/aceptación:** el dueño **acepta** (o **devuelve con motivo**) el **contrato de resultado**.
5. **Evidencia:** sobre el contrato ACEPTADO se emite el **Pasaporte de resultado** (quién, con qué, aprobaciones,
   costo, verificación) con huella (hash) y ancla de auditoría (E13); exportable para un auditor.

## 6. Criterios de aceptación del piloto

- [ ] Existe una empresa sintética con cartera y facturas vencidas (datos ficticios, marcados sandbox).
- [ ] Se crea y asigna al menos un **objetivo** con **tareas** con criterio de aceptación.
- [ ] El gestor ejecuta y toda acción con impacto económico **exige doble aprobación humana** (no hay ejecución autónoma).
- [ ] La verificación la realiza alguien **distinto** del ejecutor; un intento de autoverificación es **rechazado**.
- [ ] El dueño **acepta** un resultado y **devuelve** otro con motivo; solo el **ACEPTADO** cuenta como recaudo.
- [ ] Se emite y **verifica** el **Pasaporte** del resultado aceptado; su exportación es íntegra (cadena verde).
- [ ] Ningún envío real ni acceso a sistemas productivos; canales en modo `SIMULADO`; grabación off.
- [ ] Aislamiento multi-tenant: otra empresa no ve los datos del piloto.
- [ ] Todo queda en la **auditoría inmutable** (creación/asignación/aprobaciones/aceptación/pasaporte).

## 7. Métricas que arroja el piloto (sin inventar cifras)

- Resultados **aceptados** vs. devueltos; tiempo de ciclo asignación→aceptación.
- **Costo por resultado** (imputación E9/ADR 0002) del trabajo del piloto.
- Acciones detenidas por gobierno y aprobadas/rechazadas (E6).

## 8. Gobierno y límites (lo que el piloto NO hace)

- No contacta clientes reales ni envía correo/WhatsApp/voz reales.
- No mueve dinero ni ejecuta pagos; no usa umbrales reales (pendientes de Finanzas).
- No toca sistemas productivos ni carga credenciales reales.
- No afirma cumplimiento sectorial ni valor probatorio (pendientes de Cumplimiento/Jurídica).

## 9. Qué necesito de usted para cerrar el alcance

1. Confirmar el alcance (secciones 2 y 5) y los **criterios de aceptación** (sección 6).
2. Indicar si el **coordinador (superempleado Inc.1)** participa en este piloto o se incorpora en una segunda vuelta.
3. Confirmar que la **doble aprobación humana** para acciones económicas es la regla del piloto (por defecto, sí).

> Con su visto bueno a esta ficha, construyo el **seed sintético** y el recorrido en sandbox, y le entrego la evidencia
> (Pasaporte exportado + traza de auditoría) del resultado aceptado.
