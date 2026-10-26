import type {
  DestinoImputacionInput,
  DimensionConsolidacion,
  GrupoConsolidado,
  ImputacionCosto,
  SetRepartoInput,
  TipoDestino,
} from '../../core/imputacion.models';

/**
 * Lógica pura de la imputación de costos (ADR 0011 D5/D7 · E9 · RF44/RF45): validación visual de que el reparto suma
 * 100 %, mapeo entre filas de la UI y el contrato del backend, etiquetas en español y ayudas del gráfico de
 * consolidación. Sin dependencias de Angular para poder probarse de forma aislada (`imputacion.util.spec.ts`). El gate
 * real (suma 100 % exacta, sin repetidos, destinos existentes en la empresa) lo aplica el backend; esto es presentación.
 */

/** Tolerancia para la suma de porcentajes (coherente con el backend: evita falsos negativos por decimales). */
export const EPSILON_PORCENTAJE = 0.01;

/** Una fila del editor de reparto: tipo de destino, destino elegido y su porcentaje. */
export interface FilaReparto {
  tipo: TipoDestino;
  /** Id del destino elegido (`''` mientras no se elige). */
  destinoId: string;
  /** Porcentaje; `null` mientras el campo está vacío. */
  porcentaje: number | null;
}

/** Resultado de una validación con mensaje en español (o vacío si es válida). */
export interface ResultadoValidacion {
  ok: boolean;
  mensaje: string;
}

export interface TipoDestinoMeta {
  label: string;
  icon: string;
}

/** Metadatos por tipo de destino del reparto (línea de negocio, área o centro de costo). */
export const TIPO_DESTINO_META: Record<TipoDestino, TipoDestinoMeta> = {
  linea: { label: 'Línea de negocio', icon: 'target' },
  area: { label: 'Área', icon: 'layers' },
  centro: { label: 'Centro de costo', icon: 'wallet' },
};

export const TIPOS_DESTINO: readonly TipoDestino[] = ['linea', 'area', 'centro'];

export const tipoDestinoLabel = (tipo: TipoDestino): string => TIPO_DESTINO_META[tipo].label;

/** Nombre del campo del contrato (`lineaNegocioId`/`orgUnitId`/`centroCostoId`) que corresponde a un tipo de destino. */
export function campoDestino(tipo: TipoDestino): 'lineaNegocioId' | 'orgUnitId' | 'centroCostoId' {
  switch (tipo) {
    case 'linea':
      return 'lineaNegocioId';
    case 'area':
      return 'orgUnitId';
    default:
      return 'centroCostoId';
  }
}

/** Clave estable de una fila (tipo + destino) para detectar destinos repetidos. `''` si aún no hay destino. */
export function claveFila(fila: FilaReparto): string {
  return fila.destinoId ? `${fila.tipo}:${fila.destinoId}` : '';
}

/** Suma de los porcentajes de las filas (los vacíos cuentan como 0). Redondeada a 2 decimales. */
export function sumaPorcentajes(filas: FilaReparto[]): number {
  const total = filas.reduce((acc, f) => acc + (f.porcentaje ?? 0), 0);
  return Math.round(total * 100) / 100;
}

/** `true` si la suma de porcentajes cuadra en 100 % (dentro de la tolerancia). */
export function repartoCuadra(filas: FilaReparto[]): boolean {
  // La diferencia se redondea a 2 decimales para evitar el ruido de coma flotante en el borde (p. ej. 99.99).
  return Math.round(Math.abs(sumaPorcentajes(filas) - 100) * 100) / 100 <= EPSILON_PORCENTAJE;
}

/**
 * Valida el reparto COMPLETO en la UI (espejo de `validarReparto` del backend, RF45): al menos una fila; cada fila con
 * un destino elegido y un porcentaje en (0, 100]; sin destinos repetidos; y la suma = 100 %. Devuelve el primer
 * problema encontrado para no dejar guardar y poder resaltarlo.
 */
export function validarRepartoUI(filas: FilaReparto[]): ResultadoValidacion {
  if (!filas.length) {
    return { ok: false, mensaje: 'El reparto debe tener al menos un destino.' };
  }
  const vistos = new Set<string>();
  for (const f of filas) {
    if (!f.destinoId) {
      return { ok: false, mensaje: 'Cada fila debe tener un destino (línea, área o centro de costo).' };
    }
    if (f.porcentaje === null || !(f.porcentaje > 0) || f.porcentaje > 100) {
      return { ok: false, mensaje: 'Cada porcentaje debe ser mayor que 0 y como máximo 100.' };
    }
    const clave = claveFila(f);
    if (vistos.has(clave)) {
      return { ok: false, mensaje: 'Un mismo destino no puede aparecer dos veces en el reparto.' };
    }
    vistos.add(clave);
  }
  if (!repartoCuadra(filas)) {
    return { ok: false, mensaje: `El reparto debe sumar 100 %. Suma actual: ${sumaPorcentajes(filas).toFixed(2)} %.` };
  }
  return { ok: true, mensaje: '' };
}

/** Convierte una fila de la UI en un destino del contrato (porcentaje a 2 decimales). */
export function filaADestino(fila: FilaReparto): DestinoImputacionInput {
  return { [campoDestino(fila.tipo)]: fila.destinoId, porcentaje: Math.round((fila.porcentaje ?? 0) * 100) / 100 };
}

/** Arma el cuerpo de `setReparto` a partir del periodo y las filas de la UI. */
export function construirReparto(periodoKey: string, filas: FilaReparto[]): SetRepartoInput {
  return { periodoKey: periodoKey.trim(), destinos: filas.map(filaADestino) };
}

/** Tipo de destino de una imputación persistida según qué campo trae informado. */
export function tipoDeImputacion(imp: ImputacionCosto): TipoDestino {
  if (imp.lineaNegocioId) return 'linea';
  if (imp.orgUnitId) return 'area';
  return 'centro';
}

/** Mapea el reparto persistido (de un periodo) a filas editables de la UI, ordenadas por tipo. */
export function imputacionesAFilas(imps: ImputacionCosto[]): FilaReparto[] {
  return imps.map((imp) => {
    const tipo = tipoDeImputacion(imp);
    const destinoId = imp.lineaNegocioId ?? imp.orgUnitId ?? imp.centroCostoId ?? '';
    return { tipo, destinoId, porcentaje: Number(imp.porcentaje) };
  });
}

/** Nueva fila vacía para el editor (por defecto, apuntando a una línea de negocio). */
export function nuevaFila(tipo: TipoDestino = 'linea'): FilaReparto {
  return { tipo, destinoId: '', porcentaje: null };
}

// ============================ Periodo (clave mensual YYYY-MM) ============================

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** Clave de periodo mensual `YYYY-MM` de una fecha (por defecto, el mes en curso). */
export function periodoActual(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Etiqueta legible de un `periodoKey` mensual (`2026-10` → «octubre de 2026»); si no es mensual, lo devuelve tal cual. */
export function periodoLabel(periodoKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodoKey);
  if (!m) return periodoKey;
  const mes = Number(m[2]) - 1;
  if (mes < 0 || mes > 11) return periodoKey;
  return `${MESES[mes]} de ${m[1]}`;
}

// ============================ Consolidación (ayudas del gráfico) ============================

/** Costo total (medido + estimado) de un grupo consolidado. */
export function montoConsolidado(g: Pick<GrupoConsolidado, 'costoMedidoUsd' | 'costoEstimadoUsd'>): number {
  return g.costoMedidoUsd + g.costoEstimadoUsd;
}

/** Porcentaje (0–100) de un valor respecto al máximo, para dimensionar las barras (un decimal). */
export function barraPorcentaje(valor: number, max: number): number {
  return max > 0 ? Math.round((valor / max) * 1000) / 10 : 0;
}

/** Porcentaje (0–100) de un valor respecto al total (un decimal). */
export function porcentajeDelTotal(valor: number, total: number): number {
  return total > 0 ? Math.round((valor / total) * 1000) / 10 : 0;
}

/** Etiqueta en español de una dimensión de consolidación. */
export const DIMENSION_LABEL: Record<DimensionConsolidacion, string> = {
  empresa: 'Empresa',
  linea: 'Línea de negocio',
  area: 'Área',
  centro: 'Centro de costo',
};
