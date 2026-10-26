import type {
  DimensionTipoValor,
  DimensionValue,
  EstadoEstructura,
  GrupoAnalisis,
} from '../../../core/dimensiones.models';

/**
 * Lógica pura del marco de dimensiones configurables (ADR 0011 D8 · E1b): etiquetas en español, metadatos de badges,
 * armado del árbol de valores (roll-up), prevención de ciclos y ayudas de la consola de análisis. Sin dependencias de
 * Angular para poder probarse de forma aislada. El gate real (unicidad de código, ciclos, obligatoriedad) lo aplica el
 * backend; esto es presentación y ayuda de edición.
 */

/** Tono de badge alineado al design system (`.badge.success`, `.badge.warning`, …). */
export type Tono = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary';

/** Clase CSS de un badge según su tono; `neutral` deja solo la clase base (sin color). */
export function badgeClass(tono: Tono): string {
  return tono === 'neutral' ? 'badge' : `badge ${tono}`;
}

export interface EstadoMeta {
  label: string;
  tono: Tono;
}

/** Metadatos por estado de vigencia (ADR 0011 D2). */
export const ESTADO_META: Record<EstadoEstructura, EstadoMeta> = {
  ACTIVA: { label: 'Activa', tono: 'success' },
  SUSPENDIDA: { label: 'Suspendida', tono: 'warning' },
  CERRADA: { label: 'Cerrada', tono: 'danger' },
};
export const ESTADOS: readonly EstadoEstructura[] = ['ACTIVA', 'SUSPENDIDA', 'CERRADA'];

export interface TipoValorMeta {
  label: string;
  icon: string;
  descripcion: string;
}

/** Metadatos por tipo de valor de una dimensión (ADR 0011 D8). */
export const TIPO_VALOR_META: Record<DimensionTipoValor, TipoValorMeta> = {
  LISTA: {
    label: 'Lista',
    icon: 'list',
    descripcion: 'Valores propios que tú defines (opcionalmente en árbol para roll-up).',
  },
  REFERENCIA: {
    label: 'Referencia',
    icon: 'link',
    descripcion: 'Apunta a una entidad existente (línea de negocio, sede, centro de costo u organización).',
  },
  TEXTO: { label: 'Texto', icon: 'hash', descripcion: 'Valor libre de texto, sin catálogo.' },
  NUMERO: { label: 'Número', icon: 'hash', descripcion: 'Valor numérico libre, sin catálogo.' },
};

export const tipoValorLabel = (tipo: DimensionTipoValor): string => TIPO_VALOR_META[tipo].label;

/** Entidades admitidas para `tipoValor = REFERENCIA`, con etiqueta legible. */
export const REFERENCIA_META: { id: string; label: string }[] = [
  { id: 'LineaNegocio', label: 'Línea de negocio' },
  { id: 'Sede', label: 'Sede' },
  { id: 'CentroCosto', label: 'Centro de costo' },
  { id: 'OrgUnit', label: 'Unidad organizacional' },
];

export const referenciaLabel = (entidad: string | null): string =>
  (entidad && REFERENCIA_META.find((r) => r.id === entidad)?.label) || entidad || '—';

/** Entidades/acciones etiquetables sugeridas (`aplicaA`), con etiqueta legible (ADR 0011 D8). */
export const APLICA_A_OPCIONES: { id: string; label: string }[] = [
  { id: 'ejecucion', label: 'Ejecuciones' },
  { id: 'tarea', label: 'Tareas' },
  { id: 'costo', label: 'Costos' },
  { id: 'agente', label: 'Agentes' },
  { id: 'unidad', label: 'Unidades' },
  { id: 'linea', label: 'Líneas de negocio' },
  { id: 'servicio', label: 'Servicios' },
];

export const aplicaALabel = (id: string): string => APLICA_A_OPCIONES.find((o) => o.id === id)?.label ?? id;

/**
 * Valida el rango de vigencia: `desde` no puede ser posterior a `hasta`. Devuelve un mensaje en español o `null` si es
 * válido. Las fechas vacías son válidas (vigencia abierta). Coherente con el validador del backend.
 */
export function validarVigencia(desde?: string | null, hasta?: string | null): string | null {
  if (!desde || !hasta) return null;
  const d = new Date(desde).getTime();
  const h = new Date(hasta).getTime();
  if (Number.isNaN(d) || Number.isNaN(h)) return 'Las fechas de vigencia no son válidas.';
  if (d > h) return 'La fecha de inicio no puede ser posterior a la de fin.';
  return null;
}

/** Nodo del árbol de valores: el valor y su profundidad (para sangrar la fila). */
export interface ValorNodo {
  valor: DimensionValue;
  depth: number;
}

/**
 * Aplana la jerarquía de valores a una lista ordenada en recorrido en profundidad, anotando la profundidad de cada
 * uno (roll-up tipo NetSuite, ADR 0011 D8). Las raíces y los hijos se ordenan por código. Los valores con un `padreId`
 * inexistente (o que formaría ciclo en datos corruptos) se tratan como raíces para no perderlos ni colgarse.
 */
export function buildValorTree(valores: DimensionValue[]): ValorNodo[] {
  const byId = new Map(valores.map((v) => [v.id, v]));
  const hijosDe = new Map<string | null, DimensionValue[]>();
  for (const v of valores) {
    const padre = v.padreId && byId.has(v.padreId) ? v.padreId : null;
    const lista = hijosDe.get(padre) ?? [];
    lista.push(v);
    hijosDe.set(padre, lista);
  }
  for (const lista of hijosDe.values()) {
    lista.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es'));
  }
  const out: ValorNodo[] = [];
  const visitados = new Set<string>();
  const walk = (padreId: string | null, depth: number): void => {
    for (const v of hijosDe.get(padreId) ?? []) {
      if (visitados.has(v.id)) continue; // defensa ante ciclos en datos corruptos
      visitados.add(v.id);
      out.push({ valor: v, depth });
      walk(v.id, depth + 1);
    }
  };
  walk(null, 0);
  // Cualquier valor no alcanzado (ciclo) se añade como raíz para no ocultarlo.
  for (const v of valores) {
    if (!visitados.has(v.id)) {
      visitados.add(v.id);
      out.push({ valor: v, depth: 0 });
    }
  }
  return out;
}

/**
 * Ids de un valor y todos sus descendientes. Se usa para excluirlos del selector de «padre» al editar: colgar un valor
 * de uno de sus descendientes crearía un ciclo (ADR 0011 D8, integridad c). El propio backend lo rechaza; esto evita
 * siquiera ofrecer la opción.
 */
export function descendientesConsigo(valores: DimensionValue[], valorId: string): Set<string> {
  const hijosDe = new Map<string, DimensionValue[]>();
  for (const v of valores) {
    if (!v.padreId) continue;
    const lista = hijosDe.get(v.padreId) ?? [];
    lista.push(v);
    hijosDe.set(v.padreId, lista);
  }
  const bloqueados = new Set<string>([valorId]);
  const pila = [valorId];
  while (pila.length) {
    const id = pila.pop()!;
    for (const h of hijosDe.get(id) ?? []) {
      if (!bloqueados.has(h.id)) {
        bloqueados.add(h.id);
        pila.push(h.id);
      }
    }
  }
  return bloqueados;
}

/** Porcentaje (0–100) del costo respecto al grupo de mayor costo, para dimensionar las barras del gráfico. */
export function barraPorcentaje(costUsd: number, grupos: GrupoAnalisis[]): number {
  const max = Math.max(0, ...grupos.map((g) => g.costUsd));
  return max > 0 ? Math.round((costUsd / max) * 1000) / 10 : 0;
}

/** Porcentaje (0–100) del costo respecto al total, con un decimal. */
export function porcentajeDelTotal(costUsd: number, total: number): number {
  return total > 0 ? Math.round((costUsd / total) * 1000) / 10 : 0;
}
