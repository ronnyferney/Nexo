-- Candado de salida a internet SEGMENTADO (E8 · corrección Opción A).
-- Reemplaza el gate único `salidaInternet` por dos categorías gobernables por separado. Aditivo; default `false`
-- (concesión explícita). La comunicación con proveedores de IA NO se modela aquí (la gobierna el runtime, ADR 0010).
ALTER TABLE "Agent" ADD COLUMN     "navegacionWeb" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sistemasAutorizados" BOOLEAN NOT NULL DEFAULT false;

-- Backfill (Opción A): PRESERVA los flujos legítimos vigentes. Habilita ambas categorías para los agentes que HOY
-- podían hacer egress de red: los SIN estación (vía heredada, antes no gateados) y los que, CON estación, tenían
-- `salidaInternet = true`. Los bloqueados hoy (con estación y `salidaInternet = false`) permanecen en `false`.
-- Los agentes NUEVOS nacen en `false`: a partir de ahora el enforcement lee las categorías SIEMPRE, con o sin
-- estación. Eso CIERRA la elusión (un agente sin estación ya no queda fuera de la política) sin cortar nada vigente.
UPDATE "Agent" SET "navegacionWeb" = true, "sistemasAutorizados" = true
  WHERE "estacionVirtualId" IS NULL OR "salidaInternet" = true;
