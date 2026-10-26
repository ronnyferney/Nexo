/**
 * Modelos del dominio «voz» (E14 · ADR 0015 D2), sandbox SIN gasto. Espejo tipado del contrato de `/voz`: cuentas de
 * voz por empresa (reusan `CanalCuenta` tipo VOZ) y el ciclo de una llamada por el adaptador del proveedor
 * (iniciar → turnos → transferir → finalizar). Las credenciales se referencian SIEMPRE por `secretRef` (nombre de la
 * clave de bóveda), NUNCA el secreto en claro.
 */

import type { CanalCuenta, CanalCuentaEstado, DireccionMensaje } from './channels.models';

/** Cuenta de voz: es una `CanalCuenta` de tipo VOZ. */
export type VozCuenta = CanalCuenta;

/**
 * Estado de una llamada de voz. SIMULADA = la cursó el adaptador `simulado` (sandbox, sin salida de red);
 * FALLIDA = un stub inactivo (sin credenciales o gated) o un error de negocio; el resto es el ciclo normal.
 */
export type EstadoLlamadaVoz = 'INICIADA' | 'EN_CURSO' | 'TRANSFERIDA' | 'FINALIZADA' | 'FALLIDA' | 'SIMULADA';

/** Llamada de voz (`GET /voz/llamadas`). El audio/transcripción NO se persisten crudos (grabación OFF por defecto). */
export interface VozLlamada {
  id: string;
  workspaceId: string;
  empresaId: string | null;
  canalCuentaId: string | null;
  /** Proveedor que cursó la llamada (simulado | amazon_connect | google_cloud | ...). */
  proveedor: string;
  proveedorCallId: string;
  direccion: DireccionMensaje;
  estado: EstadoLlamadaVoz;
  tareaId: string | null;
  misionId: string | null;
  duracionSeg: number | null;
  /** Referencia (NO contenido) a la transcripción si una política la habilitara; null por defecto. */
  transcripcionRef: string | null;
  /** Coste estimado; null hasta cargar tarifas por región/minuto (no se inventan precios). */
  costoEstimado: string | null;
  createdAt: string;
}

/** Cuerpo de `POST /voz/cuentas` (solo ADMIN). Credenciales SOLO por `secretRef`. */
export interface CreateVozCuentaInput {
  empresaId: string;
  proveedor: string;
  estado?: CanalCuentaEstado;
  /** Nombre de la clave de bóveda (MAYUSCULAS_CON_GUIONES); NUNCA el valor del secreto. */
  secretRef?: string;
  config?: Record<string, unknown>;
}

/** Modo de diálogo requerido por la llamada; por defecto `externalDialog` (runtime de agentes de NEXO). */
export type VozModoDialogo = 'externalDialog' | 'providerDialog';

/** Requisitos que la llamada exige al proveedor; el backend valida contra las capabilities y bloquea las incompatibles. */
export interface RequisitosVoz {
  transferencia?: boolean;
  bargeIn?: boolean;
  dialogo?: VozModoDialogo;
}

/** Cuerpo de `POST /voz/llamadas` (EDITOR). Idempotente por `idempotencyKey`. */
export interface IniciarLlamadaInput {
  cuentaId: string;
  direccion: DireccionMensaje;
  /** Número destino (saliente) u origen (entrante). */
  numero: string;
  idempotencyKey: string;
  requisitos?: RequisitosVoz;
  tareaId?: string;
  misionId?: string;
}

/** Cuerpo de `POST /voz/llamadas/:id/turno` (EDITOR). `entrada` es texto STT: dato NO confiable. */
export interface TurnoLlamadaInput {
  entrada: string;
  bargeIn?: boolean;
}

/** Cuerpo de `POST /voz/llamadas/:id/transferir` (EDITOR). */
export interface TransferirLlamadaInput {
  destino: string;
}

/** Resolución de gobierno (E6) de una acción sensible surgida en la llamada (capa d). */
export interface GobiernoLlamada {
  tipoAccion: string;
  estado: 'PERMITIDA' | 'REQUIERE_APROBACION' | 'DENEGADA';
  motivo: string;
  aprobacionId?: string;
}

/** Resultado de `POST /voz/llamadas/:id/turno`. */
export interface ResultadoTurno {
  id: string;
  estado: EstadoLlamadaVoz;
  respuesta?: string;
  /** Transcripción STT del turno (dato NO confiable; no se persiste cruda). */
  transcripcion?: string;
  bargeIn: boolean;
  gobierno?: GobiernoLlamada;
}

/** Resultado de `POST /voz/llamadas/:id/transferir`. */
export interface ResultadoTransferencia {
  id: string;
  estado: EstadoLlamadaVoz;
  respuesta?: string;
}

/** Resultado de `POST /voz/llamadas/:id/finalizar`. */
export interface ResultadoFinalizar {
  id: string;
  estado: EstadoLlamadaVoz;
  respuesta?: string;
  duracionSeg: number | null;
}
