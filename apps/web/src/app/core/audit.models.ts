/**
 * Tipos del visor de auditoría inmutable (E13). Espejan el contrato del backend (`modules/audit/audit.*`). El registro
 * es APPEND-ONLY y a prueba de manipulación: cada entrada encadena por hash con la anterior del mismo workspace
 * (`prevHash` -> `hash`), de modo que alterar o borrar una fila rompe la cadena de forma detectable. Solo lectura y rol
 * ADMIN (el servidor es el gate real); todo filtra por `workspaceId` del token (multi-tenant).
 */

/** Tipo de actor del hecho auditado. SYSTEM no lleva `actorId`. */
export type AuditActorType = 'USER' | 'AGENT' | 'SYSTEM';

/** Entrada inmutable de la cadena de auditoría (`GET /auditoria`). Los hashes son la prueba del encadenamiento. */
export interface AuditEntry {
  id: string;
  workspaceId: string;
  /** Secuencia monotónica por workspace (1, 2, 3, ...). Base del encadenamiento. */
  seq: number;
  createdAt: string;
  actorType: AuditActorType;
  /** Id del actor (userId / agentId); null cuando `actorType = SYSTEM`. Referencia blanda. */
  actorId: string | null;
  /** Código de la acción auditada (p. ej. `APROBACION_CONCEDIDA`). Texto abierto; se traduce en la vista. */
  action: string;
  /** Tipo e id de la entidad afectada (referencias blandas). */
  targetType: string | null;
  targetId: string | null;
  /** Resumen legible en español del hecho. */
  resumen: string;
  /** Datos estructurados adicionales (nunca secretos ni cuerpos completos). */
  metadata: Record<string, unknown>;
  /** sha256 del contenido canónico: detecta cualquier alteración de los campos. */
  contentHash: string;
  /** Hash de la entrada anterior (o génesis en la primera): enlaza la cadena. */
  prevHash: string;
  /** sha256(contentHash + prevHash + seq): el eslabón de esta entrada. */
  hash: string;
}

/** Página de la lista de auditoría (paginación por cursor sobre el `id` de la última entrada). */
export interface AuditPage {
  items: AuditEntry[];
  nextCursor: string | null;
}

/** Filtros del visor. Cadenas vacías / `undefined` = sin filtro. `desde`/`hasta` en ISO-8601. */
export interface AuditFilters {
  action?: string;
  targetType?: string;
  targetId?: string;
  desde?: string;
  hasta?: string;
}

/**
 * Veredicto de `verificarCadena` (`GET /auditoria/verificacion`). Si `ok` es falso, `rotaEnSeq` indica la primera
 * entrada que falló y `motivo` el tipo de rotura (`CONTENIDO_ALTERADO | ENLACE_ROTO | SECUENCIA_ROTA | FALTANTE`).
 */
export interface AuditVerification {
  ok: boolean;
  /** Total de hechos recorridos en el workspace. */
  total: number;
  rotaEnSeq?: number;
  motivo?: string;
}
