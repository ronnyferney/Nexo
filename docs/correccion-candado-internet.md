# Corrección del candado de salida a internet — impacto y migración (requiere aprobación del CEO)

> Punto 5 del documento de decisiones del patrocinador. Este documento **prepara** la corrección: no cambia el
> comportamiento vigente. La parte que modifica comportamiento y los valores de agentes existentes queda **MARCADA para
> aprobación de Ronny Ferney Garzón Silva**; no se aplica sin su visto bueno.

## 1. Estado actual (implementado y validado)
- `Agent.salidaInternet` (bool, default `false`) + asignación opcional de `Agent.estacionVirtualId` (E8).
- Enforcement en el runtime (E8-2): antes de invocar un **conector de egress de red** (REST/SOAP/GRAPHQL/MCP; DATABASE
  se excluye por ser potencialmente local), el runtime consulta `puedeSalirAInternet(workspaceId, agentId)`.
- **Semántica vigente (station-aware):** el candado **solo bloquea** cuando el agente está **asignado a una estación
  virtual** cuya `salidaInternet = false`. Un agente **sin estación** usa la vía heredada y **no queda bloqueado**
  (comportamiento actual intacto). Cuando permite, la salida sigue pasando por `HttpClientService` (SSRF/allowlist/
  timeout/tamaño): el candado es un gate **adicional**, nunca un bypass.

## 2. Las dos observaciones del patrocinador (punto 5)
1. **Ruta de elusión:** un agente sin estación asignada no queda sujeto a la política. El CEO pide **cerrar esa ruta**.
2. **Nombre/alcance:** `salidaInternet` sobredeclara su alcance. No cubre la **comunicación con proveedores de IA** (las
   llamadas al LLM salen siempre, por diseño) ni distingue **navegación web** de **conexión a sistemas autorizados**. El
   nombre debe describir su alcance real.

## 3. Corrección propuesta (PROPUESTO — no aplicada)
### 3.1 Segmentación del control (aditiva)
Reemplazar el único `salidaInternet` por categorías explícitas, cada una gobernable por separado:
- **`navegacionWeb`** — navegación/fetch web general (buscar, leer páginas).
- **`sistemasAutorizados`** — conexión a conectores/sistemas de negocio explícitamente autorizados.
- **(IA)** — la comunicación con proveedores de IA **no** es un toggle de usuario: siempre pasa por el runtime y su
  gobierno propio (ADR 0010); se documenta para que el control no se confunda con "bloqueo total de internet".

El enforcement por categoría se aplica en el **servidor** y en las **rutas efectivas** (runtime + egress de conectores),
reutilizando `HttpClientService` y el gate ya existente. `DATABASE` local permanece fuera del alcance de "internet".

### 3.2 Cierre de la elusión (CAMBIO DE COMPORTAMIENTO — gated)
La política pasa a aplicarse **con o sin estación asignada**: un agente sin categoría habilitada no hace egress de red.
Esto **cambia el comportamiento** de los agentes existentes y por eso **requiere aprobación + migración de datos**.

## 4. Impacto de cerrar la elusión
- **Default actual:** todos los agentes nacen con `salidaInternet = false` y **sin estación**. Hoy, por la vía heredada,
  **sí** pueden invocar conectores de red. Si se cierra la elusión **sin migrar datos**, esos agentes **dejarían de
  poder** usar conectores REST/SOAP/GraphQL/MCP hasta habilitarlos explícitamente → **riesgo de corte** de flujos
  productivos en marcha.
- Por eso la corrección **no** se activa "en seco": se acompaña de una **migración explícita** que preserva el
  comportamiento esperado para los agentes vigentes.

## 5. Migración explícita propuesta (NO aplicada — pendiente de aprobación)
Dos estrategias; el CEO elige:

**Opción A — Preservar el comportamiento actual (recomendada para no cortar nada).**
Al introducir las categorías, **habilitar** `navegacionWeb = true` y `sistemasAutorizados = true` para los agentes que
**hoy** hacen egress (todos los que no están bloqueados por una estación con `salidaInternet=false`). Luego el equipo
ajusta, agente por agente, lo que deba restringirse. Efecto neto inmediato: **ningún corte**; el control queda explícito.

```sql
-- PROPUESTA (no ejecutar sin aprobación). Aditiva + backfill que preserva el comportamiento vigente.
-- 1) Nuevas columnas (aditivas, con default conservador = habilitado para no cortar):
ALTER TABLE "Agent" ADD COLUMN "navegacionWeb" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Agent" ADD COLUMN "sistemasAutorizados" BOOLEAN NOT NULL DEFAULT true;
-- 2) Backfill: respetar el bloqueo vigente de quienes SÍ estaban gateados por estación sin internet.
UPDATE "Agent" a SET "navegacionWeb" = false, "sistemasAutorizados" = false
  FROM "EstacionVirtual" e
  WHERE a."estacionVirtualId" = e."id" AND a."salidaInternet" = false;
-- 3) `salidaInternet` se mantiene una versión como campo legado (lectura) y se retira en una migración posterior,
--    una vez el runtime lea solo las categorías nuevas.
```

**Opción B — Cierre estricto (más seguro, puede cortar).**
Dejar las categorías en `false` por defecto; ningún agente hace egress hasta habilitarlo. Máxima contención, pero
**interrumpe** los flujos vigentes hasta que se habiliten uno a uno. Solo recomendable con una ventana de revisión.

## 6. Qué se puede hacer sin su aprobación (y qué no)
- **Sin aprobación (parte segura, este documento):** el diseño, la segmentación propuesta, el análisis de impacto y el
  SQL de migración preparado y reversible.
- **Requiere su aprobación (gated):** aplicar la migración, cerrar la elusión y cambiar los valores de los agentes
  existentes. Indíquenos **Opción A o B** y lo implementamos con las compuertas de validación de siempre.

## 7. Recomendación
**Opción A.** Hace explícito y gobernable el control, respeta el nombre/alcance real, cierra la elusión y **no corta**
ningún flujo en marcha. El endurecimiento posterior (pasar categorías a `false` donde corresponda) se hace por agente,
con trazabilidad en la auditoría inmutable (E13).
