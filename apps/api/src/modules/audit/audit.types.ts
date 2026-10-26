import type { AuditActorType } from '@prisma/client';

/**
 * Catálogo de acciones de gobierno auditables (E13). Texto abierto y extensible (columna `String`), pero se centraliza
 * aquí para que los puntos de integración usen los mismos códigos en español.
 */
export const AUDIT_ACTIONS = {
  APROBACION_CONCEDIDA: 'APROBACION_CONCEDIDA',
  APROBACION_RECHAZADA: 'APROBACION_RECHAZADA',
  POLITICA_CREADA: 'POLITICA_CREADA',
  POLITICA_MODIFICADA: 'POLITICA_MODIFICADA',
  POLITICA_ARCHIVADA: 'POLITICA_ARCHIVADA',
  SUSPENSION_ACTIVADA: 'SUSPENSION_ACTIVADA',
  SUSPENSION_LEVANTADA: 'SUSPENSION_LEVANTADA',
  AGENTE_PUBLICADO: 'AGENTE_PUBLICADO',
  AGENTE_SUSPENDIDO: 'AGENTE_SUSPENDIDO',
  ACCESO_SENSIBLE: 'ACCESO_SENSIBLE',
  /// Emisión de un pasaporte de resultado (ADR 0014 · E14): ancla el pasaporte a la cadena de hash de E13.
  PASAPORTE_EMITIDO: 'PASAPORTE_EMITIDO',
  /// Ciclo de vida de una Cuadrilla (plantilla de equipo gobernada, ADR 0014 · D1). Actor humano, plantilla y versión.
  CUADRILLA_CREADA: 'CUADRILLA_CREADA',
  CUADRILLA_PUBLICADA: 'CUADRILLA_PUBLICADA',
  CUADRILLA_RETIRADA: 'CUADRILLA_RETIRADA',
  CUADRILLA_INSTANCIADA: 'CUADRILLA_INSTANCIADA',
  /// Cambio de la línea de mando entre empleados digitales (E3/RF32). Actor humano, agente y supervisor previo/nuevo.
  JERARQUIA_MODIFICADA: 'JERARQUIA_MODIFICADA',
} as const;

/** Código de acción auditable. Texto abierto (`string`): se recomienda usar las constantes de `AUDIT_ACTIONS`. */
export type AuditAction = string;

/** Entrada a registrar. `workspaceId`, `seq`, hashes y `createdAt` los calcula el servicio; nunca el llamador. */
export interface AuditEntryInput {
  actorType: AuditActorType;
  actorId?: string | null;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  resumen: string;
  metadata?: Record<string, unknown>;
}

/** Resultado de `verificarCadena`: si la cadena está intacta y, si no, en qué `seq` se rompió y por qué. */
export interface VerifyChainResult {
  ok: boolean;
  total: number;
  /** `seq` de la primera entrada cuya integridad o enlace falló (solo cuando `ok = false`). */
  rotaEnSeq?: number;
  /** Código del tipo de rotura: CONTENIDO_ALTERADO | ENLACE_ROTO | SECUENCIA_ROTA | FALTANTE. */
  motivo?: string;
}
