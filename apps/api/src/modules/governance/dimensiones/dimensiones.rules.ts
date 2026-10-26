import type { EstadoEstructura } from '@prisma/client';

/**
 * Invariantes puras del marco de dimensiones configurables (ADR 0011 D8). Sin dependencias de Nest ni Prisma para
 * poder probarlas de forma aislada. Reglas de integridad: sin ciclos en la jerarquía de valores, asignabilidad por
 * estado/vigencia, y obligatoriedad de dimensiones al etiquetar trabajo con efecto económico.
 */

export type ResultadoValidacion = { ok: true } | { ok: false; mensaje: string };

/** Valor de dimensión mínimo para razonar sobre la jerarquía (sin acoplar a Prisma). */
export interface NodoValor {
  id: string;
  padreId?: string | null;
}

/** Datos mínimos de un valor para decidir si es asignable a trabajo nuevo. */
export interface ValorAsignable {
  estado: EstadoEstructura;
  vigenteDesde?: Date | null;
  vigenteHasta?: Date | null;
}

/** Definición mínima de una dimensión para validar obligatoriedad al etiquetar. */
export interface DimensionObligatoria {
  codigo: string;
  obligatoria: boolean;
  obligatoriaParaEfectoEconomico: boolean;
}

/**
 * ¿Asignar `padreId` a `valorId` crea un ciclo? Recorre hacia arriba desde el padre propuesto siguiendo `padreId`; si
 * se llega al propio `valorId` (o se excede el límite de profundidad) hay ciclo. Un valor no puede ser su propio padre.
 */
export function creariaCiclo(valores: NodoValor[], valorId: string, nuevoPadreId: string | null | undefined): boolean {
  if (!nuevoPadreId) return false;
  if (nuevoPadreId === valorId) return true;
  const byId = new Map(valores.map((v) => [v.id, v]));
  let actual: string | null | undefined = nuevoPadreId;
  let saltos = 0;
  while (actual && saltos < 1000) {
    if (actual === valorId) return true;
    actual = byId.get(actual)?.padreId ?? null;
    saltos += 1;
  }
  return saltos >= 1000;
}

/**
 * Un valor es asignable a trabajo NUEVO solo si está ACTIVA y dentro de su vigencia (ADR 0011 D8). Los valores
 * inactivos o fuera de vigencia NO se asignan a trabajo nuevo, pero se conservan en el histórico (eso no se decide
 * aquí: el snapshot ya guardado no se revalida).
 */
export function esAsignable(valor: ValorAsignable, ahora: Date = new Date()): boolean {
  if (valor.estado !== 'ACTIVA') return false;
  const t = ahora.getTime();
  if (valor.vigenteDesde && valor.vigenteDesde.getTime() > t) return false;
  if (valor.vigenteHasta && valor.vigenteHasta.getTime() < t) return false;
  return true;
}

/**
 * Dimensiones obligatorias sin valor en el snapshot (ADR 0011 D8, integridad a). Con `efectoEconomico`, cuentan las
 * `obligatoriaParaEfectoEconomico`; en otro caso solo las `obligatoria`. Devuelve los códigos que faltan. El servicio
 * ya debe haber filtrado `dimensiones` por `aplicaA` y por empresa.
 */
export function faltantesObligatorias(
  dimensiones: DimensionObligatoria[],
  snapshot: Record<string, unknown>,
  opts: { efectoEconomico: boolean },
): string[] {
  return dimensiones
    .filter((d) => (opts.efectoEconomico ? d.obligatoria || d.obligatoriaParaEfectoEconomico : d.obligatoria))
    .filter((d) => {
      const v = snapshot[d.codigo];
      return v === undefined || v === null || v === '';
    })
    .map((d) => d.codigo);
}
