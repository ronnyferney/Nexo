/**
 * Tipos de la matriz de cumplimiento configurable y MULTISECTORIAL (P1.3 · ADR 0020). Espejan el contrato del backend
 * (`modules/compliance`). El ALCANCE de una regla es la combinación jurisdicción/sector/proceso/nivelRiesgo; omitir una
 * dimensión la deja como comodín (`null` = aplica a todas). Todo es DATO configurable: no hay semántica de ningún sector
 * en el código. Las reglas NACEN INACTIVAS y la evaluación es ASESORA (no bloqueante): nunca afirma conformidad normativa.
 */

/** Nivel de riesgo del alcance (coincide con el enum `NivelRiesgo` de Prisma). */
export type NivelRiesgo = 'BAJO' | 'MEDIO' | 'ALTO' | 'CRITICO' | 'DESCONOCIDO';

/** Tipo de dato de un campo obligatorio (coincide con el enum `TipoDatoCumplimiento` de Prisma). */
export type TipoDatoCumplimiento = 'TEXTO' | 'NUMERO' | 'BOOLEANO' | 'FECHA' | 'LISTA' | 'OBJETO';

export const NIVELES_RIESGO: readonly NivelRiesgo[] = ['BAJO', 'MEDIO', 'ALTO', 'CRITICO', 'DESCONOCIDO'];
export const TIPOS_DATO: readonly TipoDatoCumplimiento[] = ['TEXTO', 'NUMERO', 'BOOLEANO', 'FECHA', 'LISTA', 'OBJETO'];

/** Regla de validación declarativa opcional (sin código ejecutable). Todas las claves son opcionales. */
export interface ReglaValidacionDeclarativa {
  /** Si `false`, el campo es OPCIONAL (no cuenta como faltante al estar ausente). Por defecto es obligatorio. */
  requerido?: boolean;
  /** Expresión regular que debe cumplir el valor de texto. */
  patron?: string;
  /** Mínimo numérico (inclusive) para `NUMERO`. */
  min?: number;
  /** Máximo numérico (inclusive) para `NUMERO`. */
  max?: number;
  /** Conjunto cerrado de valores permitidos. */
  enum?: Array<string | number | boolean>;
  /** Longitud mínima de un texto o lista. */
  longitudMin?: number;
  /** Longitud máxima de un texto o lista. */
  longitudMax?: number;
}

/** Fila de la matriz (`GET/POST/PATCH admin/compliance/rules`). */
export interface ReglaCumplimiento {
  id: string;
  workspaceId: string;
  jurisdiccion: string | null;
  sector: string | null;
  proceso: string | null;
  nivelRiesgo: NivelRiesgo | null;
  campoClave: string;
  tipoDato: TipoDatoCumplimiento;
  reglaValidacion: ReglaValidacionDeclarativa | null;
  controlProteccion: string | null;
  descripcion: string | null;
  activa: boolean;
  /** Inicio de la ventana de vigencia (ISO 8601). `null` = sin límite inferior. */
  vigenciaDesde: string | null;
  /** Fin de la ventana de vigencia (ISO 8601). `null` = sin límite superior. */
  vigenciaHasta: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Cuerpo para crear una regla. El alcance omitido viaja como `null` (comodín). */
export interface CreateReglaCumplimientoInput {
  jurisdiccion?: string | null;
  sector?: string | null;
  proceso?: string | null;
  nivelRiesgo?: NivelRiesgo | null;
  campoClave: string;
  tipoDato: TipoDatoCumplimiento;
  reglaValidacion?: ReglaValidacionDeclarativa;
  controlProteccion?: string | null;
  descripcion?: string | null;
  activa?: boolean;
  /** Inicio de la vigencia (ISO 8601). `null` limpia el campo en un PATCH. */
  vigenciaDesde?: string | null;
  /** Fin de la vigencia (ISO 8601). `null` limpia el campo en un PATCH. */
  vigenciaHasta?: string | null;
}

/** Cuerpo para actualizar una regla (PATCH parcial). */
export type UpdateReglaCumplimientoInput = Partial<CreateReglaCumplimientoInput>;

/** Contexto para resolver/evaluar. Una dimensión ausente solo admite reglas con comodín en ella. */
export interface ContextoCumplimiento {
  jurisdiccion?: string;
  sector?: string;
  proceso?: string;
  nivelRiesgo?: NivelRiesgo;
  /** Fecha de evaluación de la vigencia (ISO 8601). Omitir = ahora. */
  fechaEvaluacion?: string;
}

/** Regla ya resuelta para un `campoClave` (la más específica que ganó), con su puntuación de especificidad. */
export interface ReglaResuelta extends ReglaCumplimiento {
  especificidad: number;
}

/** Un campo obligatorio ausente en los valores evaluados. */
export interface CampoFaltante {
  campoClave: string;
  tipoDato: TipoDatoCumplimiento;
  controlProteccion: string | null;
  descripcion: string | null;
}

/** Un campo presente pero que no supera su regla de validación. */
export interface CampoInvalido {
  campoClave: string;
  motivo: string;
}

/** Resultado de la evaluación ASESORA de un conjunto de valores contra el conjunto resuelto. */
export interface EvaluacionCumplimiento {
  /** Siempre `ASESOR`: informa, NO bloquea. */
  modo: 'ASESOR';
  cumple: boolean;
  totalReglas: number;
  faltantes: CampoFaltante[];
  invalidos: CampoInvalido[];
  nota: string;
  contexto: ContextoCumplimiento;
}
