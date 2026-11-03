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
  /// Configuración (alta/cambio de banderas/umbrales/riesgo) de un tipo de acción sensible del catálogo (E6+ · punto
  /// 7). Actor humano, tipo de acción (codigo) y, en metadata, los valores anterior/nuevo de las banderas y umbrales.
  ACCION_SENSIBLE_CONFIGURADA: 'ACCION_SENSIBLE_CONFIGURADA',
  SUSPENSION_ACTIVADA: 'SUSPENSION_ACTIVADA',
  SUSPENSION_LEVANTADA: 'SUSPENSION_LEVANTADA',
  AGENTE_PUBLICADO: 'AGENTE_PUBLICADO',
  AGENTE_SUSPENDIDO: 'AGENTE_SUSPENDIDO',
  ACCESO_SENSIBLE: 'ACCESO_SENSIBLE',
  /// Emisión de un pasaporte de resultado (ADR 0014 · E14): ancla el pasaporte a la cadena de hash de E13.
  PASAPORTE_EMITIDO: 'PASAPORTE_EMITIDO',
  /// Agent Hub (ADR 0019 · Inc.1): publicar e instalar plantillas gobernadas de empleado digital. Lo opera SIEMPRE un
  /// humano (nunca un agente: respeta `AGENTE_NO_CREA_AGENTES`). Actor humano, plantilla y versión; al instalar, además
  /// el agente BORRADOR creado. La plantilla no contiene secretos ni responsable; instalar no concede accesos.
  AGENTE_PLANTILLA_PUBLICADA: 'AGENTE_PLANTILLA_PUBLICADA',
  AGENTE_PLANTILLA_INSTALADA: 'AGENTE_PLANTILLA_INSTALADA',
  /// Ciclo de vida de una Cuadrilla (plantilla de equipo gobernada, ADR 0014 · D1). Actor humano, plantilla y versión.
  CUADRILLA_CREADA: 'CUADRILLA_CREADA',
  CUADRILLA_PUBLICADA: 'CUADRILLA_PUBLICADA',
  CUADRILLA_RETIRADA: 'CUADRILLA_RETIRADA',
  CUADRILLA_INSTANCIADA: 'CUADRILLA_INSTANCIADA',
  /// Agent Hub · plantillas de CUADRILLA (ADR 0019 · Inc.3): publicar e instalar composiciones gobernadas de varios
  /// cargos/roles. Lo opera SIEMPRE un humano (nunca un agente: respeta `AGENTE_NO_CREA_AGENTES`, ADR 0016). Actor
  /// humano, plantilla de cuadrilla y versión; al instalar, además la `CuadrillaPlantilla` BORRADOR creada. La plantilla
  /// no contiene secretos, responsables ni credenciales; instalar no concede accesos (crea un borrador gobernado).
  CUADRILLA_PLANTILLA_PUBLICADA: 'CUADRILLA_PLANTILLA_PUBLICADA',
  CUADRILLA_PLANTILLA_INSTALADA: 'CUADRILLA_PLANTILLA_INSTALADA',
  /// Cambio de la línea de mando entre empleados digitales (E3/RF32). Actor humano, agente y supervisor previo/nuevo.
  JERARQUIA_MODIFICADA: 'JERARQUIA_MODIFICADA',
  /// Ciclo de vida de una estación virtual (E8). Actor humano, estación y, en el retiro, su estado previo/nuevo.
  ESTACION_VIRTUAL_CREADA: 'ESTACION_VIRTUAL_CREADA',
  ESTACION_VIRTUAL_MODIFICADA: 'ESTACION_VIRTUAL_MODIFICADA',
  ESTACION_VIRTUAL_RETIRADA: 'ESTACION_VIRTUAL_RETIRADA',
  /// Cambio de los parámetros de ejecución de un empleado digital (E8). Actor humano, agente y, para el cambio
  /// sensible del candado (`navegacionWeb`/`sistemasAutorizados`), sus valores anterior/nuevo (dirección debe poder
  /// auditar quién abrió la salida a internet, por categoría).
  PARAMETROS_EJECUCION_MODIFICADOS: 'PARAMETROS_EJECUCION_MODIFICADOS',
  /// Cambio de los controles configurables de grabación/retención de una empresa (E14 · ADR 0015 D3/D4). Actor humano,
  /// empresa y, en metadata, las banderas anterior/nuevo (cambio sensible que Jurídica debe poder auditar). Incluye el
  /// gate jurídico `grabacionAutorizadaJuridicamente` (P0.2): activarlo habilita la grabación real (solo ADMIN/OWNER).
  GRABACION_CONFIG_MODIFICADA: 'GRABACION_CONFIG_MODIFICADA',
  /// Alta/cambio/eliminación de una política de retención diferenciada por org/canal/tipo (P0.2 · decisión Jurídica).
  /// Lo opera SIEMPRE un humano ADMIN/OWNER (nunca un agente). Actor humano, target la `PoliticaRetencion` y, en
  /// metadata, el alcance y los valores anterior/nuevo (cambio sensible que Jurídica debe poder auditar).
  POLITICA_RETENCION_MODIFICADA: 'POLITICA_RETENCION_MODIFICADA',
  POLITICA_RETENCION_ELIMINADA: 'POLITICA_RETENCION_ELIMINADA',
  /// Ciclo de vida de una misión transversal (E3 · ADR 0016). Crear/autorizar/detener/cancelar lo hace SIEMPRE un
  /// humano (nunca un agente): el actor es `USER`, el target la `MisionTransversal` y, en metadata, el detalle
  /// (coordinador, dueño, motivo, estado previo/nuevo). Coordinar/vincular/participar NO concede acceso (ADR 0007).
  MISION_CREADA: 'MISION_CREADA',
  MISION_AUTORIZADA: 'MISION_AUTORIZADA',
  MISION_DETENIDA: 'MISION_DETENIDA',
  MISION_CANCELADA: 'MISION_CANCELADA',
  /// Gobierno de la CONTINUIDAD del coordinador de una misión (ADR 0016 · Inc.3 · compuerta E-B). Se registran SOLO con
  /// el opt-in `Workspace.coordinadorGobiernoActivo = true` (integración gated; con el flag apagado no hay efecto ni
  /// evento). El coordinador PROPONE/OBSERVA y SOLICITA decisión humana: nunca autoaprueba, ni amplía permisos/
  /// presupuesto, ni ejecuta alto impacto (QA13). Target: la `MisionTransversal`; metadata: metadatos saneados (sin
  /// datos sensibles ni secretos). SEGUIMIENTO/BLOQUEO/SUPERVISION son lectura/correlación; ESCALAMIENTO/
  /// DECISION_SOLICITADA/CONTRADICCION detienen y piden humano (QA10); CONTINUIDAD = suplencia al suspender (QA14);
  /// AUTOAPROBACION_BLOQUEADA = intento del coordinador de aprobar su propia acción, bloqueado y auditado (QA13).
  MISION_COORDINADOR_SEGUIMIENTO: 'MISION_COORDINADOR_SEGUIMIENTO',
  MISION_COORDINADOR_BLOQUEO: 'MISION_COORDINADOR_BLOQUEO',
  MISION_COORDINADOR_ESCALAMIENTO: 'MISION_COORDINADOR_ESCALAMIENTO',
  MISION_COORDINADOR_SUPERVISION: 'MISION_COORDINADOR_SUPERVISION',
  MISION_COORDINADOR_DECISION_SOLICITADA: 'MISION_COORDINADOR_DECISION_SOLICITADA',
  MISION_COORDINADOR_CONTINUIDAD: 'MISION_COORDINADOR_CONTINUIDAD',
  MISION_COORDINADOR_CONTRADICCION: 'MISION_COORDINADOR_CONTRADICCION',
  MISION_COORDINADOR_AUTOAPROBACION_BLOQUEADA: 'MISION_COORDINADOR_AUTOAPROBACION_BLOQUEADA',
  /// Gobierno de la memoria operativa por proceso (ADR 0018 · Inc.3). La memoria es CONTEXTO, no concede permisos y no
  /// altera la versión del agente (ADR 0004). Actor humano (EDITOR+), target la `MemoriaOperativa` y, en metadata, el
  /// proceso y el estado previo/nuevo. CONFIRMADA: un hecho pasa de PROPUESTO a CONFIRMADO tras revisión. DESCARTADA: un
  /// hecho se elimina (descarte gobernado). CADUCADA: un hecho vencido se purga por caducidad.
  MEMORIA_CONFIRMADA: 'MEMORIA_CONFIRMADA',
  MEMORIA_DESCARTADA: 'MEMORIA_DESCARTADA',
  MEMORIA_CADUCADA: 'MEMORIA_CADUCADA',
  /// Gobierno de presupuestos (P0.1/P1.1c · ADR 0002). Lo opera SIEMPRE un humano ADMIN/OWNER (nunca un agente).
  /// OVERRIDE: autorización expresa, acotada y con vigencia, para gastar por encima del tope al 100 % (no es un bypass
  /// permanente); se registra el alcance (unidad/agente), el periodo, el motivo, el rol y la vigencia. IMPACTO: registro
  /// de validación de impacto que habilita la degradación de una bolsa no crítica. MODO_PILOTO: activar/desactivar el
  /// preset de piloto US$ 0 (solo proveedor mock), que un agente no puede desactivar.
  /// Gobierno de la matriz de cumplimiento configurable (P1.3 · ADR 0020). Alta/cambio/eliminación de una
  /// `ReglaCumplimiento`. Lo opera SIEMPRE un humano ADMIN/OWNER (nunca un agente). Actor humano, target la regla y,
  /// en metadata, el alcance y los valores anterior/nuevo (incluida la bandera `activa`: activar una regla la convierte
  /// en exigible, cambio sensible que Cumplimiento/el patrocinador deben poder auditar). No afirma conformidad normativa.
  REGLA_CUMPLIMIENTO_CREADA: 'REGLA_CUMPLIMIENTO_CREADA',
  REGLA_CUMPLIMIENTO_MODIFICADA: 'REGLA_CUMPLIMIENTO_MODIFICADA',
  REGLA_CUMPLIMIENTO_ELIMINADA: 'REGLA_CUMPLIMIENTO_ELIMINADA',
  PRESUPUESTO_OVERRIDE_CONCEDIDO: 'PRESUPUESTO_OVERRIDE_CONCEDIDO',
  PRESUPUESTO_OVERRIDE_REVOCADO: 'PRESUPUESTO_OVERRIDE_REVOCADO',
  PRESUPUESTO_IMPACTO_VALIDADO: 'PRESUPUESTO_IMPACTO_VALIDADO',
  MODO_PILOTO_MODIFICADO: 'MODO_PILOTO_MODIFICADO',
  /// Envío de un canal externo BLOQUEADO por un guardarraíl de la cuenta (lista blanca de destinatarios o tamaño
  /// máximo del cuerpo, E14 · ADR 0015 · controles de correo §2/§3). Defensa en profundidad previa al ActionGateway:
  /// el envío no sale a la red. En metadata, el `motivo` (código), el destinatario y la empresa; nunca contenido ni
  /// secretos.
  CANAL_ENVIO_BLOQUEADO: 'CANAL_ENVIO_BLOQUEADO',
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
