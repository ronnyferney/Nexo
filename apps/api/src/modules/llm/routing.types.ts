import type { ModelTier } from '@prisma/client';
import type { ModelSpecialty } from './providers/provider-catalog.types';

/**
 * Tipos del enrutamiento multi-modelo (ADR 0010, fase 1). Describen la **política** declarada por el gobierno/agente,
 * las **señales deterministas** de la tarea y la **decisión** auditable que produce `ModelRouterService`. Todo es
 * dato puro: ni BD, ni fechas, ni aleatoriedad. Las referencias de modelo usan el formato `"<providerId>:<modelId>"`.
 */

export type { ModelSpecialty, ModelTier };

/** Cómo desempatar entre candidatos válidos (ADR 0010 D3). */
export type RoutingObjective = 'cost' | 'quality' | 'balanced';

/**
 * Una regla de preferencia (ADR 0010 D2). Se evalúan **en orden**: la primera cuyo `when` aplica a las señales de la
 * tarea gana y empuja al frente los candidatos que cumplen `prefer`. `when` vacío aplica siempre.
 */
export interface RoutingRule {
  when: {
    /** Capacidad declarada por la skill o el paso. */
    capability?: ModelSpecialty;
    /** La entrada trae imágenes o documentos adjuntos. */
    hasImages?: boolean;
    /** El contexto estimado alcanza o supera este tamaño. */
    minContextTokens?: number;
  };
  prefer: {
    /** El candidato declara al menos una de estas especialidades. */
    specialties?: ModelSpecialty[];
    /** El candidato pertenece a este tier. */
    tier?: ModelTier;
    /** Referencias `"<providerId>:<modelId>"` preferidas explícitamente. */
    models?: string[];
  };
}

/** Política de enrutamiento (JSON validado aguas arriba; aquí es solo dato). */
export interface RoutingPolicy {
  objective: RoutingObjective;
  /** Reglas de preferencia en orden de prioridad. Opcional. */
  rules?: RoutingRule[];
  /** Tope de candidatos (intentos totales) por tarea. Por defecto `DEFAULT_MAX_CANDIDATES`. */
  maxCandidates?: number;
  /** Verificación cruzada opcional (ADR 0010 D4, fase 3). `undefined`/`enabled: false` ⇒ solo redactor (fase 2). */
  verify?: RoutingVerifyPolicy;
}

/**
 * Qué hacer cuando el verificador detecta un problema (ADR 0010 D4, decisión 6):
 * - `auto` (por defecto): **advierte** en tareas informativas y **exige revisión humana** antes de una acción sensible.
 * - `warn`: solo advierte siempre (nunca bloquea).
 * - `require_human`: exige revisión humana ante **cualquier** problema.
 */
export type VerifyIssuePolicy = 'auto' | 'warn' | 'require_human';

/**
 * Verificación cruzada redactor+verificador (ADR 0010 D4, decisiones 6/7). Un modelo redacta y **otro** (preferiblemente
 * de distinto `providerId`) critica/verifica contrastando con las fuentes; el veredicto se añade como contexto. Es
 * **opt-in y premium** (vive en `Agent.routing.verify`): al menos duplica costo y latencia. El runtime la **orquesta por
 * encima del gateway** (no dentro del driver); cada modelo mide e imputa su propio consumo. Dato puro, sin `eval`.
 */
export interface RoutingVerifyPolicy {
  /** Activa la verificación cruzada. Sin el sub-objeto (o `false`) el comportamiento es idéntico a la fase 2. */
  enabled: boolean;
  /** Verificador explícito `"<providerId>:<modelId>"`. Si falta, se elige con las reglas de D2/D3 sobre el catálogo. */
  model?: string;
  /** Preferir (exigir) un verificador de **distinto `providerId`** que el redactor; reduce la correlación de sesgos. */
  requireDifferentProvider?: boolean;
  /** Política de veredicto ante un problema. Por defecto `auto` (decisión 6). */
  onIssue?: VerifyIssuePolicy;
}

/**
 * Señales **deterministas** de la tarea (ADR 0010 D2/D3, decisión 5: sin clasificador LLM). La modalidad (imágenes o
 * documentos) implica necesidad de `VISION`; la capacidad la declara la skill o el paso; el contexto estimado se mide.
 */
export interface RoutingSignals {
  /** Capacidad requerida por la skill o el tipo de paso. */
  capability?: ModelSpecialty;
  /** La entrada incluye imágenes. */
  hasImages?: boolean;
  /** La entrada incluye documentos adjuntos. */
  hasDocuments?: boolean;
  /** Tamaño de contexto estimado de la entrada, en tokens. */
  estimatedContextTokens?: number;
}

/**
 * Modelo candidato tal como lo necesita el router. Derivado de lo que el catálogo del workspace ya expone
 * (`LlmModel.tier/specialties/contextTokens/precio/needsPricing`): el runtime mapea `gateway.catalog` a este tipo
 * mínimo y se lo pasa; el router no toca BD. `contextTokens` es `null` cuando la ventana no está verificada.
 */
export interface RoutingCandidate {
  providerId: string;
  modelId: string;
  tier: ModelTier;
  /** Especialidades verificadas; `['GENERAL']` cuando no hay datos (igual que `serializeModel`). */
  specialties: ModelSpecialty[];
  contextTokens: number | null;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  /** Importado sin tarifa verificada (precio 0): no descuenta presupuesto; se deja al final. */
  needsPricing: boolean;
}

/** Contexto de entrada de `ModelRouterService.route`. */
export interface RoutingContext {
  policy: RoutingPolicy;
  candidates: RoutingCandidate[];
  task: RoutingSignals;
}

/**
 * Código auditable del porqué de una selección (ADR 0010 D5: una regla/código, **nunca** el razonamiento del modelo).
 */
export type RoutingReasonCode =
  | 'CAPACIDAD_REQUERIDA'
  | 'VISION_REQUERIDA'
  | 'CAPACIDAD_NO_DECLARADA'
  | 'REGLA_PREFERENCIA'
  | 'OBJETIVO_COSTO'
  | 'OBJETIVO_CALIDAD'
  | 'OBJETIVO_EQUILIBRADO'
  | 'PENDIENTE_DE_TARIFA'
  | 'VERIFICACION_CRUZADA';

/** Código auditable de un aviso de enrutamiento (equivalente a los `notice` del chat/ejecución). */
export type RoutingNoticeCode =
  | 'CAPACIDAD_NO_DECLARADA'
  | 'CONTEXTO_INSUFICIENTE'
  | 'PENDIENTES_DE_TARIFA'
  | 'RECORTE_MAX_CANDIDATOS'
  | 'SIN_CANDIDATOS';

export interface RoutingNotice {
  code: RoutingNoticeCode;
  /** Mensaje en español para el chat/ejecución. */
  message: string;
}

/** Un candidato ya ordenado, con su referencia y los códigos de motivo que lo justifican. */
export interface RoutedCandidate {
  /** `"<providerId>:<modelId>"`. */
  ref: string;
  providerId: string;
  modelId: string;
  /** Posición en la lista (0 = primario). */
  rank: number;
  /** Motivos auditables de la selección y su orden. */
  reasons: RoutingReasonCode[];
}

/**
 * Resultado del router: lista ordenada (primario + respaldos) ya recortada a `maxCandidates`, su versión plana de
 * referencias y los avisos emitidos. El runtime consume `refs`/`candidates` como hoy consume `fallbackModels`.
 */
export interface RoutingDecision {
  candidates: RoutedCandidate[];
  /** `candidates.map(c => c.ref)`, por comodidad del consumidor. */
  refs: string[];
  notices: RoutingNotice[];
}

/** Tope de intentos por tarea por defecto (ADR 0010 D7, decisión 4): 3 intentos totales, no 3 modelos por tarea. */
export const DEFAULT_MAX_CANDIDATES = 3;
