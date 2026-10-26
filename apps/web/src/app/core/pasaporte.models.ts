/**
 * Tipos del Pasaporte de Resultado (ADR 0014 · E14). Espejan el contrato del backend (`modules/results/pasaporte.*`).
 * Un `PasaporteResultado` es la CADENA DE CUSTODIA verificable de un `ContratoResultado` ACEPTADO: se compone por
 * REFERENCIAS + HASHES (nunca copia datos sensibles) y se ancla a la auditoría inmutable. Todo filtra por `workspaceId`
 * (multi-tenant); emitir exige EDITOR+, leer/verificar/exportar basta VIEWER+ (el servidor es el gate real).
 */

/** Referencia + hash del contenido relevante de una entidad: lo que viaja al pasaporte sin exponer el contenido. */
export interface RefHash {
  id: string;
  hash: string;
}

/** Empleado digital que intervino (referencia blanda enriquecida con versión/responsable si el `Agent` existe). */
export interface AgenteRef {
  agentId: string;
  roles: string[];
  responsableUserId: string | null;
  agentVersionId: string | null;
}

/** Operación de conector usada. Hoy el runtime aún no enlaza la operación con la ejecución: la lista puede venir vacía. */
export interface ConectorRef {
  connectorOperationId: string;
  executionId: string | null;
}

/** Totales agregados del documento: costo total imputado y conteos por categoría. */
export interface PasaporteTotales {
  costoTotalUsd: string;
  numEjecuciones: number;
  numMensajes: number;
  numTransferencias: number;
  numAprobaciones: number;
  numValidaciones: number;
  numUsageRecords: number;
}

/**
 * Cuerpo canónico de referencias + hashes + totales. Algunas listas pueden venir vacías (p. ej. `conectores`): se
 * muestran con honestidad, no se inventan datos.
 */
export interface DocumentoRef {
  contrato: { id: string; version: number; hash: string };
  tarea: { id: string; hash: string } | null;
  agentes: AgenteRef[];
  transferencias: RefHash[];
  mensajes: RefHash[];
  ejecuciones: RefHash[];
  conectores: ConectorRef[];
  aprobaciones: RefHash[];
  validaciones: RefHash[];
  usageRecords: RefHash[];
  auditSeqs: number[];
  totales: PasaporteTotales;
}

/** Pasaporte de resultado (`POST /contracts/:id/passport`, `GET /passports/:id`). Append-only. */
export interface PasaporteResultado {
  id: string;
  workspaceId: string;
  contratoResultadoId: string;
  tareaId: string | null;
  documentoRef: DocumentoRef;
  documentHash: string;
  auditSeq: number;
  auditEntryId: string;
  /** Si el resultado se reabrió/corrigió, apunta al pasaporte anterior (nunca se reescribe el previo). */
  reemplazaAId: string | null;
  emitidoPorUserId: string | null;
  createdAt: string;
}

/** Ancla a la cadena de auditoría inmutable. `hash` puede ser null si la entrada de ancla no se encuentra. */
export interface PasaporteAncla {
  auditSeq: number;
  auditEntryId?: string;
  hash: string | null;
}

/** Veredicto de la verificación extremo a extremo (`GET /passports/:id/verify`). */
export interface PasaporteVerificacion {
  ok: boolean;
  /** Código del motivo cuando `ok` es falso (p. ej. `REFERENCIA_ALTERADA`, `ANCLA_NO_CUADRA`, `CADENA_*`). */
  motivo?: string;
  emitidoEl: string;
  ancla: PasaporteAncla;
}

/** Cuerpo exportable para un auditor externo (`GET /passports/:id/export`). */
export interface PasaporteExport {
  pasaporte: {
    id: string;
    contratoResultadoId: string;
    tareaId: string | null;
    reemplazaAId: string | null;
    emitidoPorUserId: string | null;
    emitidoEl: string;
  };
  documentoRef: DocumentoRef;
  documentHash: string;
  ancla: {
    auditSeq: number;
    auditEntryId: string;
    auditHash: string | null;
    prevHash: string | null;
  };
  instrucciones: {
    algoritmo: string;
    descripcion: string;
  };
}
