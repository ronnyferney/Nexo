import type {
  CreateReglaCumplimientoInput,
  NivelRiesgo,
  ReglaCumplimiento,
  ReglaValidacionDeclarativa,
  TipoDatoCumplimiento,
} from '../../core/compliance.models';

/**
 * Lógica pura de la consola de cumplimiento (P1.3 · ADR 0020), sin Angular: etiquetas en español, texto del alcance,
 * conversión entre la fila `ReglaCumplimiento` y el borrador editable del formulario, y validación del borrador. Se
 * mantiene aquí, con pruebas unitarias propias, para que el componente sea solo presentación y estado reactivo.
 */

export const NIVEL_RIESGO_LABELS: Record<NivelRiesgo, string> = {
  BAJO: 'Bajo',
  MEDIO: 'Medio',
  ALTO: 'Alto',
  CRITICO: 'Crítico',
  DESCONOCIDO: 'Desconocido',
};

export const TIPO_DATO_LABELS: Record<TipoDatoCumplimiento, string> = {
  TEXTO: 'Texto',
  NUMERO: 'Número',
  BOOLEANO: 'Booleano',
  FECHA: 'Fecha',
  LISTA: 'Lista',
  OBJETO: 'Objeto',
};

export function nivelRiesgoLabel(n: NivelRiesgo | null): string {
  return n ? (NIVEL_RIESGO_LABELS[n] ?? n) : 'Todos';
}

export function tipoDatoLabel(t: TipoDatoCumplimiento): string {
  return TIPO_DATO_LABELS[t] ?? t;
}

/** Texto legible del alcance de una regla (comodines se muestran como «Todas/Todos»). */
export function alcanceTexto(r: Pick<ReglaCumplimiento, 'jurisdiccion' | 'sector' | 'proceso' | 'nivelRiesgo'>): string {
  const partes = [
    `Jurisdicción: ${r.jurisdiccion ?? 'todas'}`,
    `Sector: ${r.sector ?? 'todos'}`,
    `Proceso: ${r.proceso ?? 'todos'}`,
    `Riesgo: ${r.nivelRiesgo ? nivelRiesgoLabel(r.nivelRiesgo) : 'todos'}`,
  ];
  return partes.join(' · ');
}

/** ¿La regla es obligatoria? (obligatoria salvo que su regla declarativa indique `requerido: false`). */
export function esObligatoria(r: Pick<ReglaCumplimiento, 'reglaValidacion'>): boolean {
  return r.reglaValidacion?.requerido !== false;
}

/**
 * Estado de la ventana de VIGENCIA de una regla respecto a un instante (independiente de activa/inactiva):
 * - `siempre`: sin límites de vigencia (rige en cualquier fecha);
 * - `vigente`: el instante cae dentro de la ventana;
 * - `pendiente`: la ventana empieza en el futuro (aún no entra en vigor);
 * - `expirada`: la ventana ya terminó.
 */
export type EstadoVigencia = 'siempre' | 'vigente' | 'pendiente' | 'expirada';

/** Milisegundos del inicio de vigencia (comienzo del instante indicado). */
function inicioMs(iso: string): number {
  return Date.parse(iso);
}

/** Milisegundos del fin de vigencia; una fecha sin hora (`YYYY-MM-DD`) es inclusiva hasta el final de ese día. */
function finMs(iso: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return Date.parse(iso) + 86_400_000 - 1;
  return Date.parse(iso);
}

/** Calcula el estado de vigencia de una regla en un instante dado (por defecto, ahora). */
export function estadoVigencia(
  r: Pick<ReglaCumplimiento, 'vigenciaDesde' | 'vigenciaHasta'>,
  ahora: number = Date.now(),
): EstadoVigencia {
  const desde = r.vigenciaDesde ?? null;
  const hasta = r.vigenciaHasta ?? null;
  if (!desde && !hasta) return 'siempre';
  if (desde) {
    const ini = inicioMs(desde);
    if (!Number.isNaN(ini) && ahora < ini) return 'pendiente';
  }
  if (hasta) {
    const fin = finMs(hasta);
    if (!Number.isNaN(fin) && ahora > fin) return 'expirada';
  }
  return 'vigente';
}

/** ¿La regla está dentro de su ventana de vigencia en el instante dado? (`siempre` y `vigente` son true). */
export function estaVigente(
  r: Pick<ReglaCumplimiento, 'vigenciaDesde' | 'vigenciaHasta'>,
  ahora: number = Date.now(),
): boolean {
  const e = estadoVigencia(r, ahora);
  return e === 'siempre' || e === 'vigente';
}

/** Etiqueta corta del estado de vigencia para los indicadores de la UI. */
export function estadoVigenciaLabel(e: EstadoVigencia): string {
  switch (e) {
    case 'siempre':
      return 'Sin límite';
    case 'vigente':
      return 'Vigente hoy';
    case 'pendiente':
      return 'Aún no vigente';
    case 'expirada':
      return 'Fuera de vigencia';
  }
}

/** Formatea una fecha ISO (con o sin hora) a `dd/mm/aaaa` de forma determinista. */
export function formatVigenciaFecha(iso: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Texto legible de la ventana de vigencia de una regla. */
export function vigenciaTexto(r: Pick<ReglaCumplimiento, 'vigenciaDesde' | 'vigenciaHasta'>): string {
  const desde = r.vigenciaDesde ?? null;
  const hasta = r.vigenciaHasta ?? null;
  if (!desde && !hasta) return 'Sin límite (rige siempre)';
  if (desde && !hasta) return `Desde ${formatVigenciaFecha(desde)}`;
  if (!desde && hasta) return `Hasta ${formatVigenciaFecha(hasta)}`;
  return `${formatVigenciaFecha(desde)} – ${formatVigenciaFecha(hasta)}`;
}

/** Normaliza el valor de un control `<input type="date">` (ISO con o sin hora) a `YYYY-MM-DD` para el formulario. */
export function fechaADateInput(iso: string | null): string {
  if (!iso) return '';
  const m = /^\d{4}-\d{2}-\d{2}/.exec(iso);
  return m ? m[0] : '';
}

/** Filtros del listado, enlazados a los controles. Cadenas vacías = sin filtro. */
export interface ReglaFiltros {
  jurisdiccion: string;
  sector: string;
  proceso: string;
  nivelRiesgo: NivelRiesgo | '';
  /** '' = todas, 'activa' = solo activas, 'inactiva' = solo inactivas. */
  estado: '' | 'activa' | 'inactiva';
  /** Texto libre contra campoClave/descripción. */
  texto: string;
}

export const EMPTY_FILTROS: ReglaFiltros = {
  jurisdiccion: '',
  sector: '',
  proceso: '',
  nivelRiesgo: '',
  estado: '',
  texto: '',
};

export function hayFiltrosActivos(f: ReglaFiltros): boolean {
  return !!(f.jurisdiccion || f.sector || f.proceso || f.nivelRiesgo || f.estado || f.texto.trim());
}

/** Aplica los filtros a la lista de reglas (coincidencia insensible a mayúsculas y acentos en el texto libre). */
export function filtrarReglas(reglas: ReglaCumplimiento[], f: ReglaFiltros): ReglaCumplimiento[] {
  const texto = normalizar(f.texto);
  return reglas.filter((r) => {
    if (f.jurisdiccion && (r.jurisdiccion ?? '') !== f.jurisdiccion) return false;
    if (f.sector && (r.sector ?? '') !== f.sector) return false;
    if (f.proceso && (r.proceso ?? '') !== f.proceso) return false;
    if (f.nivelRiesgo && r.nivelRiesgo !== f.nivelRiesgo) return false;
    if (f.estado === 'activa' && !r.activa) return false;
    if (f.estado === 'inactiva' && r.activa) return false;
    if (texto) {
      const heno = normalizar(`${r.campoClave} ${r.descripcion ?? ''} ${r.controlProteccion ?? ''}`);
      if (!heno.includes(texto)) return false;
    }
    return true;
  });
}

/** Normaliza para buscar: minúsculas y sin acentos. */
export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Valores únicos y ordenados de una dimensión del alcance (para poblar los selectores de filtro). */
export function valoresDistintos(reglas: ReglaCumplimiento[], dim: 'jurisdiccion' | 'sector' | 'proceso'): string[] {
  const set = new Set<string>();
  for (const r of reglas) {
    const v = r[dim];
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Borrador editable del formulario (todo como primitivos sencillos para enlazar con `ngModel`). */
export interface ReglaDraft {
  id: string | null;
  jurisdiccion: string;
  sector: string;
  proceso: string;
  nivelRiesgo: NivelRiesgo | '';
  campoClave: string;
  tipoDato: TipoDatoCumplimiento;
  controlProteccion: string;
  descripcion: string;
  activa: boolean;
  /** Vigencia (valores de `<input type="date">`, `YYYY-MM-DD`). Vacío = sin límite. */
  vigenciaDesde: string;
  vigenciaHasta: string;
  // Regla de validación declarativa (desglosada en controles guiados).
  requerido: boolean;
  patron: string;
  min: number | null;
  max: number | null;
  longitudMin: number | null;
  longitudMax: number | null;
  /** Valores permitidos (uno por línea o separados por coma). Vacío = sin restricción de conjunto. */
  enumTexto: string;
}

/** Borrador en blanco para «Nueva regla» (nace INACTIVA y obligatoria). */
export function nuevoDraft(): ReglaDraft {
  return {
    id: null,
    jurisdiccion: '',
    sector: '',
    proceso: '',
    nivelRiesgo: '',
    campoClave: '',
    tipoDato: 'TEXTO',
    controlProteccion: '',
    descripcion: '',
    activa: false,
    vigenciaDesde: '',
    vigenciaHasta: '',
    requerido: true,
    patron: '',
    min: null,
    max: null,
    longitudMin: null,
    longitudMax: null,
    enumTexto: '',
  };
}

/** Borrador a partir de una regla existente (para editar). */
export function draftDeRegla(r: ReglaCumplimiento): ReglaDraft {
  const v = r.reglaValidacion ?? {};
  return {
    id: r.id,
    jurisdiccion: r.jurisdiccion ?? '',
    sector: r.sector ?? '',
    proceso: r.proceso ?? '',
    nivelRiesgo: r.nivelRiesgo ?? '',
    campoClave: r.campoClave,
    tipoDato: r.tipoDato,
    controlProteccion: r.controlProteccion ?? '',
    descripcion: r.descripcion ?? '',
    activa: r.activa,
    vigenciaDesde: fechaADateInput(r.vigenciaDesde),
    vigenciaHasta: fechaADateInput(r.vigenciaHasta),
    requerido: v.requerido !== false,
    patron: v.patron ?? '',
    min: v.min ?? null,
    max: v.max ?? null,
    longitudMin: v.longitudMin ?? null,
    longitudMax: v.longitudMax ?? null,
    enumTexto: Array.isArray(v.enum) ? v.enum.map((x) => String(x)).join('\n') : '',
  };
}

/** Parte el texto de valores permitidos en elementos (por línea o coma), sin vacíos. */
export function parseEnum(texto: string): string[] {
  return texto
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Construye la regla de validación declarativa a partir del borrador (solo claves con valor). */
export function construirReglaValidacion(d: ReglaDraft): ReglaValidacionDeclarativa {
  const regla: ReglaValidacionDeclarativa = {};
  // `requerido` se persiste siempre que sea false (obligatorio es el valor por defecto implícito).
  if (!d.requerido) regla.requerido = false;
  if (d.patron.trim()) regla.patron = d.patron.trim();
  if (d.min !== null && d.min !== undefined) regla.min = Number(d.min);
  if (d.max !== null && d.max !== undefined) regla.max = Number(d.max);
  if (d.longitudMin !== null && d.longitudMin !== undefined) regla.longitudMin = Number(d.longitudMin);
  if (d.longitudMax !== null && d.longitudMax !== undefined) regla.longitudMax = Number(d.longitudMax);
  const valores = parseEnum(d.enumTexto);
  if (valores.length) regla.enum = valores;
  return regla;
}

/** Convierte el borrador al cuerpo de la API (alcance vacío = comodín `null`). */
export function draftAInput(d: ReglaDraft): CreateReglaCumplimientoInput {
  return {
    jurisdiccion: d.jurisdiccion.trim() || null,
    sector: d.sector.trim() || null,
    proceso: d.proceso.trim() || null,
    nivelRiesgo: d.nivelRiesgo || null,
    campoClave: d.campoClave.trim(),
    tipoDato: d.tipoDato,
    reglaValidacion: construirReglaValidacion(d),
    controlProteccion: d.controlProteccion.trim() || null,
    descripcion: d.descripcion.trim() || null,
    activa: d.activa,
    // Vacío = sin límite; enviar `null` limpia el campo en un PATCH.
    vigenciaDesde: d.vigenciaDesde.trim() || null,
    vigenciaHasta: d.vigenciaHasta.trim() || null,
  };
}

/** Valida el borrador y devuelve el motivo del primer error, o null si es válido. */
export function validarDraft(d: ReglaDraft): string | null {
  if (!d.campoClave.trim()) return 'El campo clave es obligatorio.';
  if (d.campoClave.trim().length > 120) return 'El campo clave no puede superar 120 caracteres.';
  if (d.patron.trim()) {
    try {
      new RegExp(d.patron.trim());
    } catch {
      return 'El patrón (expresión regular) no es válido.';
    }
  }
  if (d.min !== null && d.max !== null && Number(d.min) > Number(d.max)) {
    return 'El mínimo no puede ser mayor que el máximo.';
  }
  if (d.longitudMin !== null && d.longitudMax !== null && Number(d.longitudMin) > Number(d.longitudMax)) {
    return 'La longitud mínima no puede ser mayor que la máxima.';
  }
  const desde = d.vigenciaDesde.trim();
  const hasta = d.vigenciaHasta.trim();
  if (desde && hasta) {
    const ini = Date.parse(desde);
    const fin = Date.parse(hasta);
    if (Number.isNaN(ini) || Number.isNaN(fin)) return 'Las fechas de vigencia no son válidas.';
    if (ini > fin) return 'La vigencia «desde» no puede ser posterior a la vigencia «hasta».';
  }
  return null;
}

/** Resumen legible de la regla de validación de una fila (para la columna «Validación»). */
export function reglaValidacionResumen(r: Pick<ReglaCumplimiento, 'reglaValidacion'>): string {
  const v = r.reglaValidacion;
  if (!v) return esObligatoria(r) ? 'Obligatorio' : 'Opcional';
  const partes: string[] = [v.requerido === false ? 'Opcional' : 'Obligatorio'];
  if (v.patron) partes.push('patrón');
  if (v.min !== undefined) partes.push(`mín ${v.min}`);
  if (v.max !== undefined) partes.push(`máx ${v.max}`);
  if (v.longitudMin !== undefined) partes.push(`long ≥ ${v.longitudMin}`);
  if (v.longitudMax !== undefined) partes.push(`long ≤ ${v.longitudMax}`);
  if (Array.isArray(v.enum) && v.enum.length) partes.push(`enum (${v.enum.length})`);
  return partes.join(' · ');
}
