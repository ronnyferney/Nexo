import { canonicalize, sha256 } from '../audit/audit.hashing';

/**
 * Composición PURA del cuerpo canónico del pasaporte de resultado (ADR 0014 · E14). Sin Nest, Prisma ni Redis: recibe
 * datos planos (filas ya leídas) y produce el documento de REFERENCIAS + HASHES y su `documentHash` determinista. Reusa
 * el algoritmo de hashing de la auditoría inmutable (`audit.hashing`: JSON canónico con claves ordenadas + sha256), de
 * modo que el mismo contenido referenciado produce SIEMPRE el mismo hash, reproducible por un tercero. NUNCA copia datos
 * sensibles: por cada referencia guarda solo su id y el hash de su contenido relevante en el momento de emitir.
 */

/** Hash determinista del contenido relevante de una referencia (mismo algoritmo que `audit.hashing`). */
export function hashRef(contenido: unknown): string {
  return sha256(canonicalize(contenido));
}

export interface ContratoInput {
  id: string;
  version: number;
  estado: string;
  tipoResultado: string;
  nivelRiesgo: number;
  resultadoEsperado: string;
  indicador: string | null;
  responsableAgentId: string | null;
  duenoUserId: string | null;
  comprometidoAt: string | null;
}

export interface TareaInput {
  id: string;
  titulo: string;
  estado: string;
  responsableAgentId: string | null;
  duenoUserId: string | null;
  criterioAceptacion: string | null;
}

/** Referencia blanda a un empleado digital que intervino (y su versión/responsable si el `Agent` existe). */
export interface AgenteInput {
  agentId: string;
  roles: string[];
  responsableUserId: string | null;
  agentVersionId: string | null;
}

export interface TransferenciaInput {
  id: string;
  secuenciaSegmento: number;
  fromAgentId: string | null;
  toAgentId: string | null;
  estado: string;
  createdAt: string;
  decididoAt: string | null;
}

export interface MensajeInput {
  id: string;
  messageId: string;
  tipo: string;
  emisorAgentId: string | null;
  destinatarioAgentId: string | null;
  enviadoAt: string;
  resueltoAt: string | null;
}

export interface EjecucionInput {
  id: string;
  status: string;
  workflowId: string;
  secuenciaSegmento: number | null;
  finishedAt: string | null;
}

export interface ConectorInput {
  connectorOperationId: string;
  executionId: string | null;
}

export interface AprobacionInput {
  id: string;
  estado: string;
  tipoAccion: string;
  riesgo: string;
  contentHash: string;
}

export interface ValidacionInput {
  id: string;
  modo: string;
  veredicto: string;
  verificadorAgentId: string | null;
  validadorUserId: string | null;
  motivo: string | null;
  version: number;
  createdAt: string;
}

export interface UsageRecordInput {
  id: string;
  executionId: string | null;
  model: string;
  providerId: string;
  costUsd: string;
  createdAt: string;
}

export interface PasaporteComposerInput {
  contrato: ContratoInput;
  tarea: TareaInput | null;
  agentes: AgenteInput[];
  transferencias: TransferenciaInput[];
  mensajes: MensajeInput[];
  ejecuciones: EjecucionInput[];
  conectores: ConectorInput[];
  aprobaciones: AprobacionInput[];
  validaciones: ValidacionInput[];
  usageRecords: UsageRecordInput[];
  /** `seq` de las entradas de `AuditLog` relevantes (contrato/tarea), sin la propia emisión. Orden ascendente. */
  auditSeqs: number[];
}

/** Referencia + hash de su contenido: lo que viaja al pasaporte, sin exponer el contenido en sí. */
interface Ref {
  id: string;
  hash: string;
}

export interface DocumentoRef {
  contrato: { id: string; version: number; hash: string };
  tarea: { id: string; hash: string } | null;
  agentes: AgenteInput[];
  transferencias: Ref[];
  mensajes: Ref[];
  ejecuciones: Ref[];
  // Conectores/operaciones usadas. Hoy no hay vínculo directo `Tarea`→`ConnectorOperation` en el esquema: el runtime
  // aún no enlaza la operación concreta con la ejecución de la tarea. Se incluye la lista (vacía si no hay vínculo) y
  // se poblará sin cambio de contrato cuando el runtime registre ese enlace. NO se inventan datos.
  conectores: ConectorInput[];
  aprobaciones: Ref[];
  validaciones: Ref[];
  usageRecords: Ref[];
  auditSeqs: number[];
  totales: {
    costoTotalUsd: string;
    numEjecuciones: number;
    numMensajes: number;
    numTransferencias: number;
    numAprobaciones: number;
    numValidaciones: number;
    numUsageRecords: number;
  };
}

/** Suma de costos imputados (strings Decimal) con precisión de 8 decimales, sin depender de coma flotante. */
function sumarCostos(usageRecords: UsageRecordInput[]): string {
  // Se opera en "nanoUSD" (enteros * 1e8) para evitar errores de coma flotante; el formato de `UsageRecord.costUsd`
  // es Decimal(18,8). `BigInt` da suma exacta.
  const totalNano = usageRecords.reduce((acc, u) => acc + decimalAEnteroNano(u.costUsd), 0n);
  const neg = totalNano < 0n;
  const abs = (neg ? -totalNano : totalNano).toString().padStart(9, '0');
  const entero = abs.slice(0, -8);
  const frac = abs.slice(-8);
  return `${neg ? '-' : ''}${entero}.${frac}`;
}

function decimalAEnteroNano(valor: string): bigint {
  const [entero, frac = ''] = valor.replace(/^\+/, '').split('.');
  const fracPad = (frac + '00000000').slice(0, 8);
  const signo = entero.startsWith('-') ? -1n : 1n;
  const enteroAbs = entero.replace('-', '') || '0';
  return signo * (BigInt(enteroAbs) * 100000000n + BigInt(fracPad || '0'));
}

/**
 * Compone el cuerpo canónico (referencias + hashes + totales) y su `documentHash`. Determinista: ordena las colecciones
 * por id/seq para que el orden de lectura de la BD no altere el hash.
 */
export function componerDocumento(input: PasaporteComposerInput): { documentoRef: DocumentoRef; documentHash: string } {
  const agentes = [...input.agentes].sort((a, b) => a.agentId.localeCompare(b.agentId));
  const transferencias = ordenarRefs(input.transferencias.map((t) => ({ id: t.id, hash: hashRef(t) })));
  const mensajes = ordenarRefs(input.mensajes.map((m) => ({ id: m.id, hash: hashRef(m) })));
  const ejecuciones = ordenarRefs(input.ejecuciones.map((e) => ({ id: e.id, hash: hashRef(e) })));
  const aprobaciones = ordenarRefs(input.aprobaciones.map((a) => ({ id: a.id, hash: hashRef(a) })));
  const validaciones = ordenarRefs(input.validaciones.map((v) => ({ id: v.id, hash: hashRef(v) })));
  const usageRecords = ordenarRefs(input.usageRecords.map((u) => ({ id: u.id, hash: hashRef(u) })));
  const conectores = [...input.conectores].sort((a, b) => a.connectorOperationId.localeCompare(b.connectorOperationId));
  const auditSeqs = [...input.auditSeqs].sort((a, b) => a - b);

  const documentoRef: DocumentoRef = {
    contrato: { id: input.contrato.id, version: input.contrato.version, hash: hashRef(input.contrato) },
    tarea: input.tarea ? { id: input.tarea.id, hash: hashRef(input.tarea) } : null,
    agentes,
    transferencias,
    mensajes,
    ejecuciones,
    conectores,
    aprobaciones,
    validaciones,
    usageRecords,
    auditSeqs,
    totales: {
      costoTotalUsd: sumarCostos(input.usageRecords),
      numEjecuciones: input.ejecuciones.length,
      numMensajes: input.mensajes.length,
      numTransferencias: input.transferencias.length,
      numAprobaciones: input.aprobaciones.length,
      numValidaciones: input.validaciones.length,
      numUsageRecords: input.usageRecords.length,
    },
  };

  return { documentoRef, documentHash: hashRef(documentoRef) };
}

function ordenarRefs(refs: Ref[]): Ref[] {
  return [...refs].sort((a, b) => a.id.localeCompare(b.id));
}
