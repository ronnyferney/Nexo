/**
 * Tipos del trabajo por resultados (E4 · RF07/RF08/RF29/RF30/RF31). Espejan el contrato del backend
 * (`apps/api/src/modules/results`). Distinguen el estado OPERATIVO de la tarea (`EstadoTarea`) del estado del
 * RESULTADO verificable (`EstadoResultado`): son ortogonales. Toda entidad filtra por `workspaceId` (multi-tenant)
 * y las mutaciones exigen EDITOR+ (el servidor es el gate real). Las referencias a OrgUnit/User/Agent son blandas.
 */

// ============================ Enumeraciones de estado ============================

/** Estado OPERATIVO de la tarea (RF08). COMPLETADA como DAG no implica resultado ACEPTADO. */
export type EstadoTarea =
  | 'PENDIENTE'
  | 'EN_EJECUCION'
  | 'ESPERANDO_APROBACION'
  | 'BLOQUEADA'
  | 'EN_REVISION'
  | 'COMPLETADA'
  | 'FALLIDA_CANCELADA';
export const ESTADOS_TAREA: readonly EstadoTarea[] = [
  'PENDIENTE',
  'EN_EJECUCION',
  'ESPERANDO_APROBACION',
  'BLOQUEADA',
  'EN_REVISION',
  'COMPLETADA',
  'FALLIDA_CANCELADA',
];

/** Estado del RESULTADO verificable (RF29/RF31). */
export type EstadoResultado =
  | 'PROPUESTO'
  | 'COMPROMETIDO'
  | 'EN_PRODUCCION'
  | 'PENDIENTE_VALIDACION'
  | 'ACEPTADO'
  | 'DEVUELTO_INCUMPLIDO';
export const ESTADOS_RESULTADO: readonly EstadoResultado[] = [
  'PROPUESTO',
  'COMPROMETIDO',
  'EN_PRODUCCION',
  'PENDIENTE_VALIDACION',
  'ACEPTADO',
  'DEVUELTO_INCUMPLIDO',
];

/** Un producto intermedio (un correo redactado) no satisface un resultado de negocio (un recaudo confirmado). */
export type TipoResultado = 'PRODUCTO_INTERMEDIO' | 'RESULTADO_NEGOCIO';
export const TIPOS_RESULTADO: readonly TipoResultado[] = ['PRODUCTO_INTERMEDIO', 'RESULTADO_NEGOCIO'];

/** Estados de resultado a los que `avanzar` puede llevar (el resto lo deciden comprometer/validar/recuperación). */
export type EstadoResultadoAvance = 'EN_PRODUCCION' | 'PENDIENTE_VALIDACION';

/** Modo de verificación del resultado (RF30/ADR 0010 D4). */
export type ModoValidacion = 'DETERMINISTA' | 'HUMANA' | 'ASISTIDA';
export const MODOS_VALIDACION: readonly ModoValidacion[] = ['DETERMINISTA', 'HUMANA', 'ASISTIDA'];

/** Veredicto de una verificación. */
export type Veredicto = 'ACEPTA' | 'DEVUELVE';
export const VEREDICTOS: readonly Veredicto[] = ['ACEPTA', 'DEVUELVE'];

// ============================ Entidades ============================

/** Objetivo (RF07): indicador, línea base, meta y plazo con dueño humano y responsable digital. Agrupa tareas. */
export interface Objetivo {
  id: string;
  workspaceId: string;
  orgUnitId: string | null;
  codigo: string;
  nombre: string;
  indicador: string | null;
  lineaBase: string | null;
  meta: string | null;
  plazo: string | null;
  duenoUserId: string | null;
  responsableAgentId: string | null;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { tareas: number };
}

/** Resumen del contrato que acompaña a una tarea en el listado. */
export interface ContratoResumen {
  id: string;
  estado: EstadoResultado;
  tipoResultado: TipoResultado;
}

/** Tarea tal como llega en el listado (`GET /tareas`). */
export interface Tarea {
  id: string;
  workspaceId: string;
  orgUnitId: string | null;
  objetivoId: string | null;
  titulo: string;
  descripcion: string | null;
  criterioAceptacion: string | null;
  entradas: Record<string, unknown>;
  responsableAgentId: string | null;
  equipoId: string | null;
  duenoUserId: string | null;
  prioridad: number;
  fechaLimite: string | null;
  estado: EstadoTarea;
  tipoResultado: TipoResultado;
  parentTareaId: string | null;
  profundidadDelegacion: number;
  correlationId: string | null;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
  contratoResultado?: ContratoResumen | null;
  _count?: { executions: number; incumplimientos: number; evidencias: number };
}

/** Evidencia: REFERENCIA autorizada a la fuente (RF35), no copia de datos sensibles. */
export interface Evidencia {
  id: string;
  workspaceId: string;
  contratoResultadoId: string | null;
  tareaId: string | null;
  tipo: string;
  descripcion: string | null;
  referencia: Record<string, unknown>;
  hash: string | null;
  propietarioUserId: string | null;
  vigenteHasta: string | null;
  createdAt: string;
}

/** Verificación del resultado (RF30). El verificador es SIEMPRE distinto del ejecutor. */
export interface ValidacionResultado {
  id: string;
  workspaceId: string;
  contratoResultadoId: string;
  modo: ModoValidacion;
  verificadorAgentId: string | null;
  validadorUserId: string | null;
  reglaAplicada: Record<string, unknown> | null;
  veredicto: Veredicto;
  motivo: string | null;
  evidenciaIds: string[];
  version: number;
  createdAt: string;
}

/** Contrato de resultado (RF29): el resultado esperado como objeto verificable. Comprometido es inmutable. */
export interface ContratoResultado {
  id: string;
  workspaceId: string;
  tareaId: string | null;
  resultadoEsperado: string;
  alcance: string | null;
  entradas: Record<string, unknown>;
  responsableAgentId: string | null;
  duenoUserId: string | null;
  fecha: string | null;
  presupuestoUsd: string | number | null;
  indicador: string | null;
  reglaValidacion: Record<string, unknown>;
  evidenciaExigida: string[];
  tipoResultado: TipoResultado;
  nivelRiesgo: number;
  estado: EstadoResultado;
  version: number;
  comprometidoAt: string | null;
  createdAt: string;
  updatedAt: string;
  validaciones?: ValidacionResultado[];
  evidencias?: Evidencia[];
  tarea?: Tarea | null;
}

/** Incumplimiento + plan de recuperación (RF31): límites explícitos de reintentos, gasto y ciclos. */
export interface Incumplimiento {
  id: string;
  workspaceId: string;
  tareaId: string;
  causa: string;
  responsableUserId: string | null;
  escalaAgentId: string | null;
  planRecuperacion: string | null;
  plazo: string | null;
  maxReintentos: number;
  maxCostoUsd: string | number | null;
  maxCiclos: number;
  intentos: number;
  ciclos: number;
  resuelto: boolean;
  resolucion: string | null;
  resueltoAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Tarea con el detalle completo (`GET /tareas/:id`). */
export interface TareaDetalle extends Tarea {
  contratoResultado: ContratoResultado | null;
  evidencias: Evidencia[];
  incumplimientos: Incumplimiento[];
  objetivo: { id: string; codigo: string; nombre: string } | null;
}

/** Resultado de una verificación (`POST /contratos/:id/validar`). */
export interface ResultadoValidacion {
  validacion: ValidacionResultado;
  estadoResultado: EstadoResultado;
  requiereRevisionHumana: boolean;
}

// ============================ Entradas de mutación ============================

export interface ObjetivoInput {
  codigo: string;
  nombre: string;
  orgUnitId?: string | null;
  indicador?: string | null;
  lineaBase?: string | null;
  meta?: string | null;
  plazo?: string | null;
  duenoUserId?: string | null;
  responsableAgentId?: string | null;
}

export interface TareaInput {
  titulo: string;
  descripcion?: string | null;
  objetivoId?: string | null;
  orgUnitId?: string | null;
  criterioAceptacion?: string | null;
  entradas?: Record<string, unknown>;
  responsableAgentId?: string | null;
  equipoId?: string | null;
  duenoUserId?: string | null;
  prioridad?: number;
  fechaLimite?: string | null;
  tipoResultado?: TipoResultado;
  parentTareaId?: string | null;
  correlationId?: string | null;
}

export interface CambioEstadoTareaInput {
  estado: EstadoTarea;
  motivo?: string;
}

export interface ContratoInput {
  resultadoEsperado: string;
  alcance?: string | null;
  entradas?: Record<string, unknown>;
  responsableAgentId?: string | null;
  duenoUserId?: string | null;
  fecha?: string | null;
  presupuestoUsd?: number | null;
  indicador?: string | null;
  reglaValidacion?: Record<string, unknown>;
  evidenciaExigida?: string[];
  tipoResultado?: TipoResultado;
  nivelRiesgo?: number;
}

export interface EvidenciaInput {
  tipo: string;
  descripcion?: string | null;
  referencia?: Record<string, unknown>;
  hash?: string | null;
  propietarioUserId?: string | null;
  vigenteHasta?: string | null;
}

export interface ValidacionInput {
  modo: ModoValidacion;
  verificadorAgentId?: string | null;
  validadorUserId?: string | null;
  veredicto?: Veredicto;
  contexto?: Record<string, unknown>;
  critica?: string;
  evidenciaIds?: string[];
  motivo?: string;
}

export interface IncumplimientoInput {
  causa: string;
  planRecuperacion?: string | null;
  responsableUserId?: string | null;
  escalaAgentId?: string | null;
  plazo?: string | null;
  maxReintentos?: number;
  maxCiclos?: number;
  maxCostoUsd?: number;
}

export interface IntentoInput {
  reintento?: boolean;
  ciclo?: boolean;
  nota?: string;
}

/** Filtro de listado de tareas (lado servidor: estado y objetivo). */
export interface TareaFiltro {
  estado?: EstadoTarea;
  objetivoId?: string;
}
