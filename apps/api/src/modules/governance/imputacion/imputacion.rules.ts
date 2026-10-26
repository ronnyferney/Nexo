/**
 * Invariantes puras del reparto de costos de servicios compartidos (ADR 0011 D5 / E9 · RF45). Sin dependencias de Nest
 * ni Prisma para poder probarlas de forma aislada. Reglas: cada fila tiene exactamente un destino, el porcentaje es
 * válido y la suma por (servicio, periodo) es 100 %; el reparto de un costo medido distribuye el total EXACTO entre los
 * destinos (un mismo gasto no se cuenta dos veces: la suma de lo repartido = el total medido). El presupuesto y la
 * reserva viven en `OrgUnit`/`Budget` (ADR 0002): esto es reporte, no un segundo libro mayor ni una segunda reserva.
 */

export type ResultadoValidacion = { ok: true } | { ok: false; mensaje: string };

/** Fila de reparto: un destino (exactamente uno de los tres) y su porcentaje. */
export interface DestinoReparto {
  lineaNegocioId?: string | null;
  orgUnitId?: string | null;
  centroCostoId?: string | null;
  porcentaje: number;
}

/** Tolerancia para la suma de porcentajes (evita falsos negativos por decimales, p. ej. 33.33 * 3). */
export const EPSILON_PORCENTAJE = 0.01;

/** Cuántos campos de destino vienen informados en una fila (debe ser exactamente 1). */
export function contarDestinos(d: DestinoReparto): number {
  return [d.lineaNegocioId, d.orgUnitId, d.centroCostoId].filter((v) => !!v).length;
}

/**
 * Clave estable del destino para detectar repetidos y para agrupar en la consolidación. Prefijo por tipo para que una
 * línea y un área con el mismo id (improbable) nunca colisionen.
 */
export function destinoKey(d: DestinoReparto): string {
  if (d.lineaNegocioId) return `linea:${d.lineaNegocioId}`;
  if (d.orgUnitId) return `area:${d.orgUnitId}`;
  if (d.centroCostoId) return `centro:${d.centroCostoId}`;
  return '';
}

/**
 * Valida el reparto COMPLETO de un servicio+periodo (RF45): al menos un destino; cada fila con exactamente un destino y
 * un porcentaje en (0, 100]; sin destinos repetidos (evita contar un destino dos veces); y la suma = 100 %.
 */
export function validarReparto(destinos: DestinoReparto[]): ResultadoValidacion {
  if (!destinos.length) {
    return { ok: false, mensaje: 'El reparto debe tener al menos un destino.' };
  }
  const vistos = new Set<string>();
  let suma = 0;
  for (const d of destinos) {
    const n = contarDestinos(d);
    if (n !== 1) {
      return {
        ok: false,
        mensaje: 'Cada fila del reparto debe tener exactamente un destino (línea, área o centro de costo).',
      };
    }
    if (!(d.porcentaje > 0) || d.porcentaje > 100) {
      return { ok: false, mensaje: 'Cada porcentaje debe ser mayor que 0 y como máximo 100.' };
    }
    const key = destinoKey(d);
    if (vistos.has(key)) {
      return { ok: false, mensaje: 'Un mismo destino no puede aparecer dos veces en el reparto (sin doble conteo).' };
    }
    vistos.add(key);
    suma += d.porcentaje;
  }
  if (Math.abs(suma - 100) > EPSILON_PORCENTAJE) {
    return { ok: false, mensaje: `El reparto debe sumar 100 %. Suma actual: ${suma.toFixed(2)} %.` };
  }
  return { ok: true };
}

/** Peso de un destino en el reparto (su clave y su porcentaje). */
export interface PesoDestino {
  key: string;
  porcentaje: number;
}

/** Monto asignado a un destino tras repartir un costo medido. */
export interface MontoImputado {
  key: string;
  montoUsd: number;
}

/**
 * Reparte un `costoTotal` medido entre los destinos según sus porcentajes (RF45). Redondea a 8 decimales y hace que el
 * ÚLTIMO destino absorba el resto, de modo que la suma de los montos sea EXACTAMENTE `costoTotal` (sin doble conteo ni
 * pérdida por redondeo): el total imputado = total medido. No valida la suma de porcentajes (usar `validarReparto`
 * antes); si los pesos no suman 100, reparte proporcionalmente igualmente y el último absorbe la diferencia.
 */
export function repartirCosto(costoTotal: number, pesos: PesoDestino[]): MontoImputado[] {
  if (!pesos.length) return [];
  const redondear = (n: number) => Math.round(n * 1e8) / 1e8;
  const resultado: MontoImputado[] = [];
  let acumulado = 0;
  for (let i = 0; i < pesos.length; i += 1) {
    const esUltimo = i === pesos.length - 1;
    const monto = esUltimo ? redondear(costoTotal - acumulado) : redondear((costoTotal * pesos[i].porcentaje) / 100);
    acumulado = redondear(acumulado + monto);
    resultado.push({ key: pesos[i].key, montoUsd: monto });
  }
  return resultado;
}
