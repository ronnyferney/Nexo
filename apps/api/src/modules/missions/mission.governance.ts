import type { NivelJerarquico } from '@prisma/client';
import { creariaCiclo, rangoNivel, resolverNivel } from '../hierarchy/hierarchy.rules';

/**
 * Gobierno PURO del coordinador de una misión transversal (ADR 0016 · Incremento 3). Sin dependencias de Nest/Prisma/
 * Redis (solo el tipo `NivelJerarquico`, un enum): es la especificación viva de las reglas de gobierno del coordinador
 * (superempleado) y se prueba de forma aislada en `mission.governance.spec.ts`.
 *
 * DISEÑO, NO OPERATIVO. Este módulo NO está cableado al runtime: no lo importan `missions.service.ts`, el controlador
 * ni el `MissionsModule`. Modela la LÓGICA de decisión que la implementación operativa del Inc.3 deberá cablear más
 * adelante (compuerta E-B del ADR 0016), reutilizando el gobierno de acciones existente (E6: `PolicyEngine`/
 * `ActionGateway`/`Aprobacion`/`Suspension`, ADR 0013) y la suplencia/coherencia de `modules/hierarchy` (E3).
 *
 * Invariantes que codifica (D4/D5 del ADR 0016):
 *  - El coordinador PROPONE y OBSERVA; lo irreversible/alto impacto lo decide un humano (bandeja de aprobaciones E6).
 *  - No autoaprobación (QA13): nadie aprueba su propia acción; una acción de alto impacto solo la aprueba un HUMANO.
 *  - No ampliar presupuesto (RF40/QA13): el coordinador no sube su bolsa ni mueve presupuesto sin aprobación humana.
 *  - Delegar/asignar transfiere SUBCONJUNTOS de permisos (ADR 0014/E5): nunca amplía; supervisar no concede acceso.
 *  - Contradicción sin regla inequívoca → DETENER + pedir decisión humana (QA10); sin ciclos de supervisión.
 */

// ---------------------------------------------------------------------------------------------------------------------
// 1. Clasificación de impacto de las acciones del coordinador (qué exige autorización humana)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Acciones que el coordinador puede PROTAGONIZAR. Se separan deliberadamente las de lectura/correlación/notificación
 * (que el coordinador sí ejecuta por sí mismo) de las de alto impacto o irreversibles (que SIEMPRE requieren
 * autorización humana por diseño). La lista es exhaustiva a propósito: una acción desconocida se trata como de alto
 * impacto (conservador).
 */
export type AccionCoordinador =
  // --- Bajo impacto: lectura, correlación, notificación. El coordinador las ejecuta; no tienen efecto externo. ---
  | 'SEGUIMIENTO' // consolidar estado de compromisos
  | 'DETECTAR_BLOQUEO' // correlacionar incumplimientos/dependencias
  | 'OBSERVAR_SUPERVISION' // leer metadatos de desempeño de agentes participantes
  | 'RECOMENDAR_CORRECCION' // proponer reasignar/pausar/reentrenar (propuesta, NO ejecución)
  | 'ESCALAR' // elevar a un responsable humano
  | 'SOLICITAR_DECISION_HUMANA' // crear la solicitud de decisión en la bandeja
  | 'NOTIFICAR' // avisar a participantes/dueños
  | 'DETENER_PARTE_AFECTADA' // freno conservador ante bloqueo (salvaguarda, no efecto externo)
  // --- Alto impacto o irreversible: SIEMPRE requieren autorización humana (E6). ---
  | 'AUTORIZAR_MISION'
  | 'DETENER_MISION'
  | 'CANCELAR_MISION'
  | 'MARCAR_LOGRADA'
  | 'APLICAR_RECOMENDACION_SUPERVISION' // ejecutar reasignar/pausar/reentrenar un agente
  | 'SUSPENDER_AGENTE'
  | 'REACTIVAR_AGENTE'
  | 'SUSPENDER_COORDINADOR'
  | 'ASIGNAR_TAREA' // asignar por primera vez una tarea a un ejecutor (dentro de nivel/alcance; aplicar exige humano)
  | 'COORDINAR_TAREA' // coordinar/priorizar una tarea ya asignada entre áreas (aplicar exige humano)
  | 'REASIGNAR_TAREA'
  | 'REASIGNAR_COORDINACION'
  | 'MOVER_PRESUPUESTO'
  | 'LANZAR_ACCION_EXTERNA'
  | 'RESOLVER_CONTRADICCION';

/** Acciones de bajo impacto que el coordinador ejecuta sin aprobación (lectura/correlación/notificación/freno). */
export const ACCIONES_BAJO_IMPACTO: readonly AccionCoordinador[] = [
  'SEGUIMIENTO',
  'DETECTAR_BLOQUEO',
  'OBSERVAR_SUPERVISION',
  'RECOMENDAR_CORRECCION',
  'ESCALAR',
  'SOLICITAR_DECISION_HUMANA',
  'NOTIFICAR',
  'DETENER_PARTE_AFECTADA',
];

/**
 * ¿La acción es de alto impacto o irreversible y por tanto requiere AUTORIZACIÓN HUMANA (E6)? Por diseño, cualquier
 * acción que no esté explícitamente en la lista de bajo impacto se considera de alto impacto (conservador): nunca se
 * "cae" del lado de ejecutar sin aprobación.
 */
export function requiereAprobacionHumana(accion: AccionCoordinador): boolean {
  return !ACCIONES_BAJO_IMPACTO.includes(accion);
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. No autoaprobación (QA13) y "solo un humano aprueba lo de alto impacto"
// ---------------------------------------------------------------------------------------------------------------------

/** Quién solicita / quién aprueba: tipo de actor para aplicar la regla de no autoaprobación. */
export type TipoActor = 'HUMANO' | 'AGENTE';

export interface SolicitudAprobacion {
  accion: AccionCoordinador;
  solicitanteId: string;
  solicitanteTipo: TipoActor;
  aprobadorId: string;
  aprobadorTipo: TipoActor;
}

export interface ResultadoAprobacion {
  /** ¿La aprobación es válida y puede surtir efecto? */
  valida: boolean;
  /** Código auditable del motivo del rechazo (o `null` si es válida). */
  motivo:
    | null
    | 'NO_REQUIERE_APROBACION'
    | 'AUTOAPROBACION_PROHIBIDA'
    | 'APROBADOR_DEBE_SER_HUMANO'
    | 'COORDINADOR_NO_SE_AUTOAPRUEBA';
}

/**
 * Valida una aprobación de acción de alto impacto respetando QA13:
 *  - Una acción de bajo impacto no necesita aprobación (se informa con `NO_REQUIERE_APROBACION`, no es un "ok" de alto
 *    impacto): el consumidor no debe usar esta función para habilitar efectos sin clasificar antes.
 *  - El aprobador debe ser HUMANO: un agente (incluido el coordinador) nunca aprueba una acción de alto impacto.
 *  - Nadie aprueba su propia acción (no autoaprobación), ni siquiera un humano.
 */
export function validarAprobacion(s: SolicitudAprobacion): ResultadoAprobacion {
  if (!requiereAprobacionHumana(s.accion)) {
    return { valida: false, motivo: 'NO_REQUIERE_APROBACION' };
  }
  if (s.aprobadorTipo !== 'HUMANO') {
    // Si además el aprobador es el propio coordinador (agente), el motivo es aún más específico.
    const esElMismoAgente = s.aprobadorId === s.solicitanteId && s.solicitanteTipo === 'AGENTE';
    return { valida: false, motivo: esElMismoAgente ? 'COORDINADOR_NO_SE_AUTOAPRUEBA' : 'APROBADOR_DEBE_SER_HUMANO' };
  }
  if (s.aprobadorId === s.solicitanteId) {
    return { valida: false, motivo: 'AUTOAPROBACION_PROHIBIDA' };
  }
  return { valida: true, motivo: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Delegación por subconjunto de permisos (ADR 0014/E5): asignar/supervisar nunca amplía
// ---------------------------------------------------------------------------------------------------------------------

export interface ResultadoDelegacion {
  /** ¿La delegación es admisible tal cual (los permisos solicitados ⊆ los del delegante)? */
  permitida: boolean;
  /** Permisos que SÍ se pueden conceder (intersección con los del delegante). Siempre un subconjunto del delegante. */
  concedidos: string[];
  /** Permisos solicitados que el delegante NO posee y por tanto NO puede transferir (ampliación prohibida). */
  excedentes: string[];
}

/**
 * Delegación/asignación por SUBCONJUNTO (ADR 0014/E5): el coordinador solo transfiere permisos que él mismo posee.
 * Devuelve siempre la intersección como `concedidos` (nunca amplía) y los `excedentes` solicitados de más. `permitida`
 * es `true` solo si no hay excedentes. Idempotente, sin duplicados y estable en el orden de entrada.
 */
export function delegacionPermitida(
  permisosDelegante: readonly string[],
  permisosSolicitados: readonly string[],
): ResultadoDelegacion {
  const delegante = new Set(permisosDelegante);
  const concedidos: string[] = [];
  const excedentes: string[] = [];
  const vistos = new Set<string>();
  for (const p of permisosSolicitados) {
    if (vistos.has(p)) continue;
    vistos.add(p);
    if (delegante.has(p)) concedidos.push(p);
    else excedentes.push(p);
  }
  return { permitida: excedentes.length === 0, concedidos, excedentes };
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Presupuesto: el coordinador no amplía ni se autoasigna presupuesto (RF40/QA13)
// ---------------------------------------------------------------------------------------------------------------------

export interface SolicitudPresupuesto {
  /** ¿La solicitud la origina el coordinador (agente) por su cuenta? */
  origenCoordinador: boolean;
  montoActual: number;
  montoSolicitado: number;
}

export interface ResultadoPresupuesto {
  /** ¿Puede aplicarse automáticamente sin aprobación humana? Solo si NO amplía y NO la origina el coordinador. */
  aplicableSinAprobacion: boolean;
  /** ¿Exige aprobación humana (E6)? Cualquier ampliación, o cualquier movimiento originado por el coordinador. */
  requiereAprobacionHumana: boolean;
  motivo: 'SIN_CAMBIO' | 'AMPLIACION_REQUIERE_APROBACION' | 'ORIGEN_COORDINADOR_REQUIERE_APROBACION';
}

/**
 * El coordinador NUNCA amplía presupuesto por su cuenta (RF40/QA13). Toda ampliación (`montoSolicitado > montoActual`)
 * exige aprobación humana; y cualquier movimiento originado por el coordinador exige aprobación aunque no amplíe
 * (mover presupuesto entre áreas es acción de alto impacto, E6). Solo una no-ampliación de origen humano es aplicable
 * sin aprobación.
 */
export function evaluarCambioPresupuesto(s: SolicitudPresupuesto): ResultadoPresupuesto {
  const amplia = s.montoSolicitado > s.montoActual;
  if (amplia) {
    return {
      aplicableSinAprobacion: false,
      requiereAprobacionHumana: true,
      motivo: 'AMPLIACION_REQUIERE_APROBACION',
    };
  }
  if (s.origenCoordinador) {
    return {
      aplicableSinAprobacion: false,
      requiereAprobacionHumana: true,
      motivo: 'ORIGEN_COORDINADOR_REQUIERE_APROBACION',
    };
  }
  return { aplicableSinAprobacion: true, requiereAprobacionHumana: false, motivo: 'SIN_CAMBIO' };
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Seguimiento de compromisos: read-model derivado (Inc.3), sin tabla nueva
// ---------------------------------------------------------------------------------------------------------------------

/** Estado de un compromiso (entrega vinculada a la misión con su `plazo`), derivado del trabajo de E4. */
export type EstadoCompromiso = 'CUMPLIDO' | 'VENCIDO' | 'EN_RIESGO' | 'EN_CURSO';

export interface EntradaCompromiso {
  /** Fecha límite comprometida (epoch ms). */
  plazoMs: number;
  /** Instante de evaluación (epoch ms). */
  ahoraMs: number;
  /** ¿El resultado ya fue entregado/presentado? */
  entregado: boolean;
  /**
   * Ventana (ms) antes del plazo a partir de la cual un compromiso NO entregado se marca EN_RIESGO. Por defecto 0
   * (sin ventana): solo VENCIDO al pasar el plazo. La implementación operativa la tomará de la política del workspace.
   */
  ventanaRiesgoMs?: number;
}

/**
 * Clasifica un compromiso de forma determinista (Inc.3):
 *  - `CUMPLIDO`: entregado (sin importar el plazo).
 *  - `VENCIDO`: no entregado y el plazo ya pasó (`ahora > plazo`).
 *  - `EN_RIESGO`: no entregado, aún no vencido, pero dentro de la ventana de riesgo previa al plazo.
 *  - `EN_CURSO`: no entregado y con holgura suficiente.
 */
export function clasificarCompromiso(e: EntradaCompromiso): EstadoCompromiso {
  if (e.entregado) return 'CUMPLIDO';
  if (e.ahoraMs > e.plazoMs) return 'VENCIDO';
  const ventana = e.ventanaRiesgoMs ?? 0;
  if (ventana > 0 && e.plazoMs - e.ahoraMs <= ventana) return 'EN_RIESGO';
  return 'EN_CURSO';
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. Detección de bloqueos: severidad derivada (Inc.3)
// ---------------------------------------------------------------------------------------------------------------------

export type OrigenBloqueo = 'INCUMPLIMIENTO' | 'EXCEPCION' | 'DEPENDENCIA_VENCIDA' | 'CONTRADICCION_AUTORIDAD';
export type SeveridadBloqueo = 'ALTA' | 'MEDIA' | 'BAJA';

export interface EntradaBloqueo {
  origen: OrigenBloqueo;
  /** ¿Frena un resultado de negocio (no solo una tarea interna)? */
  frenaResultadoNegocio: boolean;
  /** ¿No existe regla inequívoca para resolverlo automáticamente? Fuerza decisión humana. */
  sinReglaInequivoca: boolean;
}

export interface ResultadoBloqueo {
  severidad: SeveridadBloqueo;
  /** ¿Exige decisión humana (escalamiento)? Toda contradicción de autoridad o bloqueo sin regla inequívoca lo exige. */
  requiereDecisionHumana: boolean;
}

/**
 * Clasifica la severidad de un bloqueo y si exige decisión humana (Inc.3). Una contradicción de autoridad o cualquier
 * bloqueo "sin regla inequívoca" SIEMPRE exige decisión humana (QA10). Frenar un resultado de negocio sube la
 * severidad. Determinista, sin efectos.
 */
export function clasificarBloqueo(e: EntradaBloqueo): ResultadoBloqueo {
  const requiereDecisionHumana = e.sinReglaInequivoca || e.origen === 'CONTRADICCION_AUTORIDAD';
  let severidad: SeveridadBloqueo = 'BAJA';
  if (e.origen === 'CONTRADICCION_AUTORIDAD') severidad = 'ALTA';
  else if (e.frenaResultadoNegocio) severidad = 'ALTA';
  else if (e.origen === 'DEPENDENCIA_VENCIDA' || e.origen === 'INCUMPLIMIENTO') severidad = 'MEDIA';
  return { severidad, requiereDecisionHumana };
}

// ---------------------------------------------------------------------------------------------------------------------
// 7. Supervisión de otros agentes: nunca concede acceso (ADR 0007)
// ---------------------------------------------------------------------------------------------------------------------

/** Campos de supervisión que SÍ puede observar el coordinador: solo metadatos de estado/desempeño, nunca contenido. */
export const CAMPOS_SUPERVISION_PERMITIDOS: readonly string[] = [
  'compromisosCumplidos',
  'compromisosVencidos',
  'excepciones',
  'latenciaMs',
  'consumoImputado',
  'estado',
];

/**
 * Filtra la vista de supervisión a SOLO metadatos permitidos (ADR 0007: supervisar no concede acceso a datos ni
 * credenciales del agente). Cualquier campo fuera de la lista blanca se descarta. Devuelve un objeto nuevo (no muta).
 */
export function proyectarSupervision(vista: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const campo of CAMPOS_SUPERVISION_PERMITIDOS) {
    if (campo in vista) salida[campo] = vista[campo];
  }
  return salida;
}

// ---------------------------------------------------------------------------------------------------------------------
// 8. Resolución de contradicciones (QA10): autoridad vigente → prioridad → versión → si no, detener y escalar
// ---------------------------------------------------------------------------------------------------------------------

export interface OrdenCoordinacion {
  id: string;
  /** Nivel de quien emite la orden (E3). */
  nivelEmisor: NivelJerarquico | null;
  /** Prioridad declarada (mayor gana). */
  prioridad: number;
  /** Versión de la orden (mayor gana). */
  version: number;
  /** ¿La orden está vigente? Las no vigentes se descartan. */
  vigente: boolean;
}

export type ResultadoContradiccion =
  | { decision: 'ORDEN_GANADORA'; ganadoraId: string; detener: false; requiereDecisionHumana: false }
  | { decision: 'DETENER_Y_ESCALAR'; ganadoraId: null; detener: true; requiereDecisionHumana: true };

/**
 * Resuelve órdenes contradictorias reusando la semántica de autoridad de `hierarchy.rules.ts` (E3): gana la de mayor
 * autoridad; a igualdad, la de mayor prioridad; a igualdad, la de mayor versión. Si tras aplicar las tres reglas sigue
 * habiendo empate (o no hay órdenes vigentes), NO hay regla inequívoca → DETENER y pedir decisión humana (QA10). El
 * coordinador nunca "elige por su cuenta" ante un empate.
 */
export function resolverContradiccion(ordenes: readonly OrdenCoordinacion[]): ResultadoContradiccion {
  const vigentes = ordenes.filter((o) => o.vigente);
  if (vigentes.length === 0) {
    return { decision: 'DETENER_Y_ESCALAR', ganadoraId: null, detener: true, requiereDecisionHumana: true };
  }
  const ordenadas = [...vigentes].sort((a, b) => {
    const ra = rangoNivel(resolverNivel(a.nivelEmisor));
    const rb = rangoNivel(resolverNivel(b.nivelEmisor));
    if (ra !== rb) return rb - ra;
    if (a.prioridad !== b.prioridad) return b.prioridad - a.prioridad;
    return b.version - a.version;
  });
  const [primera, segunda] = ordenadas;
  if (segunda) {
    const empate =
      rangoNivel(resolverNivel(primera.nivelEmisor)) === rangoNivel(resolverNivel(segunda.nivelEmisor)) &&
      primera.prioridad === segunda.prioridad &&
      primera.version === segunda.version;
    if (empate) {
      return { decision: 'DETENER_Y_ESCALAR', ganadoraId: null, detener: true, requiereDecisionHumana: true };
    }
  }
  return { decision: 'ORDEN_GANADORA', ganadoraId: primera.id, detener: false, requiereDecisionHumana: false };
}

// ---------------------------------------------------------------------------------------------------------------------
// 9. Asignación/coordinación de tareas DENTRO de permisos (ADR 0016 · asignación gobernada): el coordinador PROPONE
// ---------------------------------------------------------------------------------------------------------------------

/** Motivo auditable del resultado de evaluar una propuesta de asignación/coordinación de tarea. */
export type MotivoAsignacion =
  | 'ADMISIBLE'
  | 'NIVEL_SUPERIOR_AL_COORDINADOR' // no asigna por encima de su nivel (decisión 2 del patrocinador)
  | 'FUERA_DE_ALCANCE'; // no asigna fuera del alcance autorizado de la misión (empresas/áreas participantes)

export interface EntradaAsignacion {
  /** Nivel del coordinador (de su `Cargo`); null → nivel base conservador. */
  nivelCoordinador: NivelJerarquico | null;
  /** Nivel del agente al que se asignaría la tarea; null → nivel base conservador. */
  nivelAsignado: NivelJerarquico | null;
  /** ¿El área/empresa destino está dentro del alcance autorizado de la misión (es participante)? */
  dentroDelAlcance: boolean;
  /** Permisos que el coordinador posee (tope): la asignación NUNCA transfiere más que esto (ADR 0014/E5). */
  permisosCoordinador: readonly string[];
  /** Permisos que la asignación pretende acompañar al ejecutor. */
  permisosSolicitados: readonly string[];
}

export interface ResultadoAsignacion {
  /** ¿El coordinador puede PROPONER esta asignación (dentro de su nivel y del alcance autorizado)? */
  admisible: boolean;
  motivo: MotivoAsignacion;
  /** Permisos que SÍ se transferirían: intersección con los del coordinador. Nunca amplía (subconjunto). */
  permisosConcedidos: string[];
  /** Permisos solicitados que el coordinador NO posee: NUNCA se conceden (asignar no concede acceso, ADR 0007). */
  permisosNoConcedidos: string[];
  /**
   * Aun siendo admisible la PROPUESTA, APLICAR la asignación es de alto impacto y exige aprobación humana (E6): el
   * coordinador propone y solicita; nunca ejecuta el efecto. Siempre `true`.
   */
  requiereAprobacionHumana: boolean;
}

/**
 * Evalúa una propuesta de asignación/coordinación de tarea del coordinador, DENTRO de sus permisos (ADR 0016 Inc.1/2):
 *  - **No por encima de su nivel:** si el agente destino tiene mayor autoridad que el coordinador → inadmisible
 *    (`NIVEL_SUPERIOR_AL_COORDINADOR`); el coordinador no manda sobre quien tiene más autoridad (decisión 2).
 *  - **No fuera del alcance autorizado:** si el área/empresa destino no participa en la misión → `FUERA_DE_ALCANCE`.
 *  - **No concede permisos (ADR 0007/0014):** solo transfiere la intersección con los suyos (`permisosConcedidos`); los
 *    `permisosSolicitados` que el coordinador no posee quedan en `permisosNoConcedidos` y NUNCA se conceden.
 *  - **Nunca ejecuta:** aun admisible, aplicarla es alto impacto y exige aprobación humana (`requiereAprobacionHumana`).
 * Determinista y pura; no persiste ni decide la ejecución.
 */
export function evaluarPropuestaAsignacion(e: EntradaAsignacion): ResultadoAsignacion {
  const deleg = delegacionPermitida(e.permisosCoordinador, e.permisosSolicitados);
  const base = {
    permisosConcedidos: deleg.concedidos,
    permisosNoConcedidos: deleg.excedentes,
    requiereAprobacionHumana: true as const,
  };
  const rangoCoord = rangoNivel(resolverNivel(e.nivelCoordinador));
  const rangoAsig = rangoNivel(resolverNivel(e.nivelAsignado));
  if (rangoAsig > rangoCoord) {
    return { admisible: false, motivo: 'NIVEL_SUPERIOR_AL_COORDINADOR', ...base };
  }
  if (!e.dentroDelAlcance) {
    return { admisible: false, motivo: 'FUERA_DE_ALCANCE', ...base };
  }
  return { admisible: true, motivo: 'ADMISIBLE', ...base };
}

/**
 * ¿Es válido que el coordinador supervise a `objetivoAgentId` sin introducir un ciclo de supervisión (QA10)? Reutiliza
 * `creariaCiclo` de `hierarchy.rules.ts`: la supervisión transversal NO puede crear un ciclo en el grafo de mando.
 * `padres` mapea cada agente a su supervisor actual (`reportaAAgentId`).
 */
export function supervisionTransversalValida(
  coordinadorAgentId: string,
  objetivoAgentId: string,
  padres: ReadonlyMap<string, string | null>,
): boolean {
  if (coordinadorAgentId === objetivoAgentId) return false;
  return !creariaCiclo(objetivoAgentId, coordinadorAgentId, padres);
}
