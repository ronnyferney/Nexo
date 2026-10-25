import { HttpException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  Agent,
  AgentExample,
  AgentKnowledge,
  AgentRunStatus,
  AgentSkill,
  AgentTool,
  Connector,
  ConnectorOperation,
  KnowledgeBase,
  Skill,
  UsageSource,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConnectorsService } from '../connectors/connectors.service';
import { BudgetExceededException } from '../governance/budget.errors';
import { BudgetsService } from '../governance/budgets.service';
import { OrgService } from '../governance/org.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import type { ResolvedModel } from '../llm/llm-gateway.service';
import { ConnectionUnavailableException } from '../llm/llm-errors';
import { LlmGatewayService } from '../llm/llm-gateway.service';
import type { AgentEvent, Effort, LlmRunResult, ToolCall, ToolOutcome, ToolSpec } from '../llm/llm-provider';
import { ModelRouterService } from '../llm/model-router.service';
import type { RoutingPolicy, RoutingReasonCode, RoutingRule, RoutingSignals } from '../llm/routing.types';
import { costUsd } from '../llm/pricing';
import { composeSystemPrompt, LOAD_SKILL_TOOL, SAVE_KNOWLEDGE_TOOL, SEARCH_KNOWLEDGE_TOOL } from './prompt-composer';

const MAX_TOOL_OUTPUT = 50_000;
/**
 * Rol del tramo que redacta la respuesta (ADR 0010 D5). En Fase 2 (sin verificación cruzada) todo turno enrutado es el
 * tramo redactor; la Fase 3 añadirá `verify` y roles de multi-agente. Sin política de enrutamiento el rol queda `null`.
 */
const DRAFT_ROLE = 'draft';
/** Separador estable entre varios códigos de motivo de enrutamiento al persistirlos en `UsageRecord.routingReason`. */
const ROUTING_REASON_SEP = ',';
/** Fragmentos que devuelve `search_knowledge`. */
const KNOWLEDGE_TOOL_RESULTS = 5;
/** Límites del documento que el agente guarda con `save_knowledge`. */
const SAVE_TITLE_MAX = 200;
const SAVE_CONTENT_MAX = 10_000;

type OperationWithConnector = ConnectorOperation & { connector: Connector };

export type AgentWithTools = Agent & {
  tools: (AgentTool & { operation: OperationWithConnector })[];
  /** ADR 0003: opcionales para no romper a quien construya el agente sin estas relaciones. */
  skills?: (AgentSkill & { skill: Skill })[];
  knowledge?: (AgentKnowledge & { knowledgeBase: Pick<KnowledgeBase, 'id' | 'name' | 'description'> })[];
  examples?: Pick<AgentExample, 'input' | 'output'>[];
};

/** Quién ejecuta y desde dónde: determina el centro de costo y la trazabilidad del consumo. */
export interface RunContext {
  source: UsageSource;
  userId?: string;
  conversationId?: string;
  workflowId?: string;
  executionId?: string;
}

export interface AgentRunOptions {
  history?: unknown[];
  message: string;
  approvedTools?: string[];
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
  context: RunContext;
  /** Proveedor con el que se generó `history`; si cambia, se descarta el historial. */
  historyProviderId?: string;
}

export interface AgentRunResult extends LlmRunResult {
  providerId: string;
  model: string;
  costUsd: number;
}

/** Acumulador de consumo de una ejecución: suma de todos los turnos e intentos de respaldo. */
interface RunTotals {
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

/** Referencia a un `AgentRun` en curso; `created` resuelve cuando la fila RUNNING se escribió (o falló, sin lanzar). */
interface AgentRunRef {
  id: string;
  created: Promise<unknown>;
}

interface ToolBinding {
  operation: OperationWithConnector;
  requiresApproval: boolean;
}

/** Lo que el modelo recibe: system prompt compuesto y herramientas (conectores, skills e internas). */
export interface PreparedAgent {
  system: string;
  tools: ToolSpec[];
  bindings: Map<string, ToolBinding>;
  skills: Skill[];
  knowledgeBaseIds: string[];
  /** Bases en las que el agente puede escribir con `save_knowledge` (subconjunto de `knowledgeBaseIds`). */
  writableKnowledgeBaseIds: string[];
}

/** Nombre de tool estable y válido para el LLM: <conector>__<operación>. */
export function toolName(connectorName: string, opKey: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  return `${slug(connectorName).slice(0, 24)}__${slug(opKey)}`.slice(0, 64);
}

/** `"<providerId>:<modelId>"` → partes (el modelo puede contener ":", p. ej. `llama3:8b`). */
export function parseModelRef(ref: string): { providerId: string; model: string } | null {
  const i = ref.indexOf(':');
  if (i <= 0 || i === ref.length - 1) return null;
  return { providerId: ref.slice(0, i), model: ref.slice(i + 1) };
}

/**
 * Lee la política de enrutamiento almacenada (`Agent.routing`, Json validado al escribir por el DTO) de forma
 * defensiva: `null`/forma inválida ⇒ `null` (modo no enrutado). No usa `eval`; solo copia campos reconocidos.
 */
export function toRoutingPolicy(raw: unknown): RoutingPolicy | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.objective !== 'cost' && o.objective !== 'quality' && o.objective !== 'balanced') return null;
  const policy: RoutingPolicy = { objective: o.objective };
  if (Array.isArray(o.rules)) policy.rules = o.rules as RoutingRule[];
  if (typeof o.maxCandidates === 'number' && o.maxCandidates > 0) policy.maxCandidates = o.maxCandidates;
  return policy;
}

/**
 * Señales **deterministas** de la tarea disponibles hoy en el runtime (ADR 0010 D2, decisión 5: sin clasificador LLM):
 * el contexto estimado (system + mensaje + historial, ≈ 4 caracteres por token) y la modalidad detectada en los bloques
 * nativos del historial (imágenes/documentos). La capacidad por skill/paso se añadirá cuando esos canales la declaren.
 */
export function taskSignals(prepared: PreparedAgent, opts: AgentRunOptions): RoutingSignals {
  const historyChars = opts.history ? JSON.stringify(opts.history).length : 0;
  const chars = prepared.system.length + opts.message.length + historyChars;
  const signals: RoutingSignals = { estimatedContextTokens: Math.ceil(chars / 4) };
  const modality = detectModality(opts.history);
  if (modality.hasImages) signals.hasImages = true;
  if (modality.hasDocuments) signals.hasDocuments = true;
  return signals;
}

/** Busca bloques de contenido `image`/`document` en el historial nativo (única entrada estructurada disponible hoy). */
function detectModality(history: unknown[] | undefined): { hasImages: boolean; hasDocuments: boolean } {
  let hasImages = false;
  let hasDocuments = false;
  for (const msg of history ?? []) {
    const content = (msg as { content?: unknown } | null)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const type = (block as { type?: unknown } | null)?.type;
      if (type === 'image') hasImages = true;
      else if (type === 'document') hasDocuments = true;
    }
  }
  return { hasImages, hasDocuments };
}

/**
 * ¿El error de `client.run` justifica probar el siguiente modelo de respaldo? Solo los errores del proveedor
 * (HTTP, red, sobrecarga, respuesta inválida). Los errores de la plataforma (`HttpException`: presupuesto agotado,
 * modelo no permitido, configuración) y la cancelación del usuario se propagan tal cual.
 */
export function isProviderFailure(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  // Conexión o modelo no disponible (sesión cerrada o revocada, deshabilitado): recuperable con un respaldo.
  if (err instanceof ConnectionUnavailableException) return true;
  if (err instanceof HttpException) return false;
  const name = (err as Error | undefined)?.name ?? '';
  return !/abort/i.test(name);
}

const truncate = (s: string) => (s.length > MAX_TOOL_OUTPUT ? `${s.slice(0, MAX_TOOL_OUTPUT)}…[truncado]` : s);
const label = (r: ResolvedModel) => `${r.model} (${r.providerLabel})`;

/**
 * Orquesta la ejecución de un agente: aplica el gobierno de costos (centro de costo, modelos permitidos,
 * presupuestos y degradación), compone el system prompt (perfil, skills, conocimiento, ejemplos), arma las tools
 * (conectores, operaciones de skills e internas `load_skill`/`search_knowledge`/`save_knowledge`), delega el bucle al proveedor,
 * mide cada turno y, si el proveedor falla, recorre la cadena de respaldo `fallbackModels` (ADR 0003, D1).
 */
@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name);

  constructor(
    private readonly gateway: LlmGatewayService,
    private readonly connectors: ConnectorsService,
    private readonly org: OrgService,
    private readonly budgets: BudgetsService,
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly router: ModelRouterService,
  ) {}

  /** System prompt y herramientas del agente, en orden estable (favorece la caché de prompts). */
  async prepare(agent: AgentWithTools): Promise<PreparedAgent> {
    const skills = (agent.skills ?? []).map((s) => s.skill).sort((a, b) => a.slug.localeCompare(b.slug));
    const bases = (agent.knowledge ?? []).map((k) => k.knowledgeBase);
    const writableKnowledgeBaseIds = (agent.knowledge ?? []).filter((k) => k.canWrite).map((k) => k.knowledgeBase.id);

    const bindings = new Map<string, ToolBinding>();
    for (const binding of agent.tools) {
      const name = toolName(binding.operation.connector.name, binding.operation.key);
      if (!bindings.has(name)) {
        bindings.set(name, { operation: binding.operation, requiresApproval: binding.requiresApproval });
      }
    }
    // Operaciones aportadas por las skills: se suman sin duplicar las ya vinculadas al agente.
    const bound = new Set(agent.tools.map((t) => t.operationId));
    const skillOpIds = [...new Set(skills.flatMap((s) => s.operationIds))].filter((id) => !bound.has(id));
    if (skillOpIds.length) {
      const ops = await this.prisma.connectorOperation.findMany({
        where: { id: { in: skillOpIds }, connector: { workspaceId: agent.workspaceId } },
        include: { connector: true },
      });
      for (const op of ops) {
        const name = toolName(op.connector.name, op.key);
        if (!bindings.has(name)) bindings.set(name, { operation: op, requiresApproval: false });
      }
    }

    const tools: ToolSpec[] = [...bindings.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, b]) => ({
        name,
        description: [
          b.operation.description ?? b.operation.name,
          b.requiresApproval ? '(Requiere aprobación humana)' : '',
        ]
          .filter(Boolean)
          .join(' '),
        inputSchema: b.operation.inputSchema as Record<string, unknown>,
      }));
    if (skills.length) {
      tools.push({
        name: LOAD_SKILL_TOOL,
        description:
          'Carga las instrucciones completas de una de tus habilidades disponibles. Úsala antes de realizar una tarea que corresponda a esa habilidad.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Identificador (slug) de la habilidad',
              enum: skills.map((s) => s.slug),
            },
          },
          required: ['name'],
          additionalProperties: false,
        },
      });
    }
    if (bases.length) {
      tools.push({
        name: SEARCH_KNOWLEDGE_TOOL,
        description:
          'Busca en la base de conocimiento de la empresa y devuelve los fragmentos más relevantes con el título de su documento. Úsala antes de responder sobre temas de la empresa.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Qué buscar, en lenguaje natural o palabras clave', maxLength: 500 },
          },
          required: ['query'],
          additionalProperties: false,
        },
      });
    }
    if (writableKnowledgeBaseIds.length) {
      tools.push({
        name: SAVE_KNOWLEDGE_TOOL,
        description:
          'Guarda en la base de conocimiento de la empresa información duradera y útil (perfiles de remitentes o destinatarios, estructura de la organización, preferencias del usuario) para recordarla en el futuro. No guardes datos efímeros ni secretos.',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Título breve y claro de lo que recuerdas',
              minLength: 1,
              maxLength: SAVE_TITLE_MAX,
            },
            content: { type: 'string', description: 'Contenido a recordar', minLength: 1, maxLength: SAVE_CONTENT_MAX },
          },
          required: ['title', 'content'],
          additionalProperties: false,
        },
      });
    }

    const system = composeSystemPrompt({
      systemPrompt: agent.systemPrompt,
      profile: agent.profile as Record<string, unknown>,
      skills,
      knowledgeBases: bases,
      examples: agent.examples ?? [],
      canWrite: writableKnowledgeBaseIds.length > 0,
    });
    return { system, tools, bindings, skills, knowledgeBaseIds: bases.map((b) => b.id), writableKnowledgeBaseIds };
  }

  /**
   * Ejecuta un turno y lo registra en `AgentRun` (instrumentación defensiva, RX-14). El registro es no-bloqueante:
   * un fallo al escribirlo se loguea y se ignora, NUNCA se propaga a la ejecución ni cambia la respuesta o la latencia
   * percibida (la fila RUNNING se crea en paralelo, no antes del primer token; la actualización final ocurre cuando la
   * respuesta ya se produjo). Captura el tiempo al primer token (primer evento de texto o tool), la duración total, el
   * costo y los tokens que ya se miden en cada turno.
   */
  async run(agent: AgentWithTools, opts: AgentRunOptions): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const totals: RunTotals = { cost: 0, inputTokens: 0, outputTokens: 0 };
    const timing = { ttftMs: null as number | null };
    const runRef = this.beginAgentRun(agent, opts.context, new Date(startedAt));
    const instrumented: AgentRunOptions = {
      ...opts,
      onEvent: (e) => {
        if (timing.ttftMs === null && (e.type === 'text' || e.type === 'tool_call')) {
          timing.ttftMs = Date.now() - startedAt;
        }
        opts.onEvent?.(e);
      },
    };
    try {
      const result = await this.execute(agent, instrumented, totals);
      // La respuesta ya se produjo (se transmitió por `onEvent`): registrar aquí no afecta la latencia percibida.
      await this.finishAgentRun(runRef, 'SUCCEEDED', {
        startedAt,
        ttftMs: timing.ttftMs,
        totals,
        providerId: result.providerId,
        model: result.model,
      });
      return result;
    } catch (err) {
      const cancelled = opts.signal?.aborted || /abort/i.test((err as Error)?.name ?? '');
      await this.finishAgentRun(runRef, cancelled ? 'CANCELLED' : 'FAILED', {
        startedAt,
        ttftMs: timing.ttftMs,
        totals,
        error: (err as Error).message,
      });
      throw err;
    }
  }

  /**
   * Ejecuta un turno. Cadena de respaldo (D1): el modelo principal se planifica y resuelve como siempre (sus errores
   * de presupuesto, permisos o configuración se propagan). Si `client.run` falla por un error del proveedor, se prueba
   * cada `fallbackModels` en orden; cada intento vuelve a pasar por `budgets.plan` (modelos permitidos, presupuesto,
   * degradación) y `gateway.resolve`, y se emite un `notice`. Un respaldo inválido o no permitido se omite con aviso;
   * un presupuesto agotado detiene la cadena. El historial nativo solo se reutiliza si el respaldo es del mismo tipo
   * de proveedor (`kind`) que el principal; si no, ese intento arranca con historial vacío. El consumo de los intentos
   * fallidos queda medido e imputado. Nota: si el principal falló a mitad del bucle, las tools ya ejecutadas pueden
   * volver a ejecutarse en el respaldo.
   */
  private async execute(agent: AgentWithTools, opts: AgentRunOptions, totals: RunTotals): Promise<AgentRunResult> {
    const ws = agent.workspaceId;
    const orgUnitId = await this.org.resolveCostCenter(ws, opts.context.userId, agent.costCenterId);
    const prepared = await this.prepare(agent);

    // Cadena de candidatos a resolver. En modo enrutado (ADR 0010) la ordena el ModelRouterService sobre el catálogo
    // del workspace; sin política (`agent.routing` == null) es la cadena estática de hoy (principal + fallbackModels).
    // En ambos casos cada candidato pasa por `budgets.plan` (permisos/presupuesto/degradación) y `gateway.resolve`
    // (DataGuard). El router solo ordena: no evade presupuesto ni permisos.
    const { chain, routed, reasons } = await this.candidateChain(agent, prepared, opts);
    // `list` es la lista de respaldos que recorre el bucle. En modo enrutado toda la cadena del router se consume como
    // respaldos (se omite con aviso el candidato no permitido; el presupuesto agotado detiene la cadena, igual que
    // `fallbackModels`); sin política, el principal `Agent.model` se planifica y resuelve aparte, como hasta hoy.
    let list: { providerId: string; model: string }[];
    let primary: ResolvedModel;
    let start: { index: number; chainIds: string[] } | null;
    let planChainIds: string[] = [];
    if (routed) {
      list = chain;
      const next = await this.nextFallback(ws, orgUnitId, list, 0, opts);
      if (!next) {
        throw new ConnectionUnavailableException(
          'El enrutamiento no dejó ningún modelo disponible dentro de los permisos y el presupuesto del agente.',
          'disabled',
        );
      }
      primary = next.resolved;
      start = { index: next.index, chainIds: next.chainIds };
    } else {
      const [head, ...rest] = chain;
      list = rest;
      const plan = await this.budgets.plan(ws, orgUnitId, head.providerId, head.model);
      if (plan.notice) opts.onEvent?.({ type: 'notice', message: plan.notice });
      planChainIds = plan.chainIds;
      start = null;
      try {
        primary = await this.gateway.resolve(ws, plan.providerId, plan.model);
      } catch (err) {
        // Principal no disponible (sesión cerrada, deshabilitado, modelo eliminado): se arranca con el primer respaldo.
        if (!(err instanceof ConnectionUnavailableException)) throw err;
        const next = await this.nextFallback(ws, orgUnitId, list, 0, opts);
        if (!next) throw err;
        opts.onEvent?.({
          type: 'notice',
          message: `El modelo ${plan.model} no está disponible (${err.message}); se usa ${label(next.resolved)}.`,
        });
        primary = next.resolved;
        start = { index: next.index, chainIds: next.chainIds };
      }
    }

    let history = opts.history ?? [];
    if (history.length && opts.historyProviderId && opts.historyProviderId !== primary.providerId) {
      opts.onEvent?.({
        type: 'notice',
        message: 'El proveedor cambió; se inicia un historial nuevo para esta respuesta.',
      });
      history = [];
    }

    let current = {
      resolved: primary,
      chainIds: start?.chainIds ?? planChainIds,
      history,
      ...this.routingTrace(routed, reasons, primary),
    };
    let failed = label(primary);
    for (let i = start ? start.index + 1 : 0; ; i++) {
      try {
        return await this.attempt(agent, opts, prepared, orgUnitId, current, totals);
      } catch (err) {
        if (!isProviderFailure(err, opts.signal)) throw err;
        this.logger.warn(`Modelo ${failed} falló para el agente ${agent.id}: ${(err as Error).message}`);
        const next = await this.nextFallback(ws, orgUnitId, list, i, opts);
        if (!next) throw err;
        i = next.index;
        opts.onEvent?.({ type: 'notice', message: `El modelo ${failed} falló; se usa ${label(next.resolved)}.` });
        current = {
          resolved: next.resolved,
          chainIds: next.chainIds,
          history: next.resolved.kind === primary.kind ? history : [],
          ...this.routingTrace(routed, reasons, next.resolved),
        };
        failed = label(next.resolved);
      }
    }
  }

  /**
   * Cadena ordenada de candidatos `{providerId, model}` a resolver. Sin política de enrutamiento (`agent.routing` ==
   * null) devuelve la cadena estática de siempre: principal `Agent.model` + `Agent.fallbackModels` (comportamiento
   * idéntico a hoy, ADR 0010 D6). Con política, invoca al `ModelRouterService` sobre el catálogo del workspace y las
   * señales deterministas de la tarea, emite un `notice` por cada aviso y por la decisión (con los códigos auditables de
   * motivo, nunca el razonamiento del modelo), y devuelve la lista ordenada. Si el router no halla candidatos (p. ej.
   * contexto insuficiente), se vuelve a la cadena estática del agente para no dejarlo sin modelo.
   */
  private async candidateChain(
    agent: AgentWithTools,
    prepared: PreparedAgent,
    opts: AgentRunOptions,
  ): Promise<{
    chain: { providerId: string; model: string }[];
    routed: boolean;
    /** Motivos auditables por referencia `"<providerId>:<modelId>"` (ADR 0010 D5); vacío sin enrutamiento. */
    reasons: Map<string, RoutingReasonCode[]>;
  }> {
    const staticChain: { providerId: string; model: string }[] = [
      { providerId: agent.provider, model: agent.model },
      ...(agent.fallbackModels ?? [])
        .map(parseModelRef)
        .filter((r): r is { providerId: string; model: string } => r !== null),
    ];
    const policy = toRoutingPolicy(agent.routing);
    if (!policy) return { chain: staticChain, routed: false, reasons: new Map() };

    const candidates = await this.gateway.routingCandidates(agent.workspaceId);
    const decision = this.router.route({ policy, candidates, task: taskSignals(prepared, opts) });
    for (const notice of decision.notices) {
      opts.onEvent?.({ type: 'notice', message: `Enrutamiento (${notice.code}): ${notice.message}` });
    }
    if (!decision.candidates.length) {
      // Ningún candidato cumple la tarea: se vuelve a la configuración por defecto del agente para no dejarlo sin modelo.
      opts.onEvent?.({
        type: 'notice',
        message: 'El enrutamiento no encontró candidatos; se usa la configuración por defecto del agente.',
      });
      return { chain: staticChain, routed: false, reasons: new Map() };
    }
    const [top, ...backups] = decision.candidates;
    opts.onEvent?.({
      type: 'notice',
      message:
        `Enrutamiento: modelo principal ${top.ref} (motivos: ${top.reasons.join(', ')})` +
        (backups.length ? `; respaldos: ${backups.map((c) => c.ref).join(', ')}.` : '.'),
    });
    const chain = decision.candidates
      .map((c) => parseModelRef(c.ref))
      .filter((r): r is { providerId: string; model: string } => r !== null);
    // Traza auditable: el motivo del tramo se persiste en `UsageRecord` a partir de esta tabla ref → códigos (D5).
    const reasons = new Map(decision.candidates.map((c) => [c.ref, c.reasons]));
    return { chain, routed: true, reasons };
  }

  /**
   * Traza de enrutamiento del tramo (ADR 0010 D5) para imputarla en `UsageRecord`. Sin política (`routed === false`)
   * ⇒ ambos `null` (comportamiento actual). Con política, el motivo son los código(s) auditable(s) del modelo resuelto
   * (nunca el razonamiento del modelo), separados por coma, y el rol es el tramo redactor ({@link DRAFT_ROLE}).
   */
  private routingTrace(
    routed: boolean,
    reasons: Map<string, RoutingReasonCode[]>,
    resolved: ResolvedModel,
  ): { routingReason: string | null; role: string | null } {
    if (!routed) return { routingReason: null, role: null };
    const codes = reasons.get(`${resolved.providerId}:${resolved.model}`) ?? [];
    return { routingReason: codes.length ? codes.join(ROUTING_REASON_SEP) : null, role: DRAFT_ROLE };
  }

  /**
   * Crea la fila `AgentRun` en estado RUNNING. No se espera: corre en paralelo a la planificación y resolución del
   * modelo para no retrasar el primer token. Nunca lanza (la escritura va envuelta en {@link safeAgentRunWrite}).
   */
  private beginAgentRun(agent: AgentWithTools, context: RunContext, startedAt: Date): AgentRunRef {
    const id = randomUUID();
    const created = this.safeAgentRunWrite(() =>
      this.prisma.agentRun.create({
        data: {
          id,
          workspaceId: agent.workspaceId,
          agentId: agent.id,
          userId: context.userId ?? null,
          source: context.source,
          status: 'RUNNING',
          startedAt,
          model: agent.model,
          providerId: agent.provider,
          conversationId: context.conversationId ?? null,
          executionId: context.executionId ?? null,
        },
      }),
    );
    return { id, created };
  }

  /**
   * Cierra la fila `AgentRun` con su estado final, duración, latencia al primer token, costo y tokens. Espera a que
   * la creación haya terminado (o fallado) para no actualizar una fila inexistente. Nunca lanza: un fallo al registrar
   * se loguea y se ignora, jamás altera la ejecución del agente. `maskedCount` queda null (no se instrumenta hoy).
   */
  private async finishAgentRun(
    ref: AgentRunRef,
    status: AgentRunStatus,
    info: {
      startedAt: number;
      ttftMs: number | null;
      totals: RunTotals;
      providerId?: string;
      model?: string;
      error?: string;
    },
  ): Promise<void> {
    await ref.created;
    const finishedAt = new Date();
    await this.safeAgentRunWrite(() =>
      this.prisma.agentRun.update({
        where: { id: ref.id },
        data: {
          status,
          finishedAt,
          durationMs: finishedAt.getTime() - info.startedAt,
          ttftMs: info.ttftMs,
          costUsd: info.totals.cost,
          inputTokens: info.totals.inputTokens,
          outputTokens: info.totals.outputTokens,
          ...(info.providerId ? { providerId: info.providerId } : {}),
          ...(info.model ? { model: info.model } : {}),
          ...(info.error ? { error: info.error.slice(0, 2000) } : {}),
        },
      }),
    );
  }

  /** Envoltura defensiva de toda escritura de `AgentRun`: un fallo se loguea y se ignora; nunca se propaga. */
  private async safeAgentRunWrite<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`No se pudo registrar AgentRun (se ignora): ${(err as Error).message}`);
      return undefined;
    }
  }

  /** Siguiente respaldo utilizable a partir de `fallbacks[from]`; omite (con aviso) los no disponibles. */
  private async nextFallback(
    ws: string,
    orgUnitId: string,
    fallbacks: { providerId: string; model: string }[],
    from: number,
    opts: AgentRunOptions,
  ): Promise<{ index: number; resolved: ResolvedModel; chainIds: string[] } | null> {
    for (let j = from; j < fallbacks.length; j++) {
      const ref = fallbacks[j];
      try {
        const plan = await this.budgets.plan(ws, orgUnitId, ref.providerId, ref.model);
        if (plan.notice) opts.onEvent?.({ type: 'notice', message: plan.notice });
        const resolved = await this.gateway.resolve(ws, plan.providerId, plan.model);
        return { index: j, resolved, chainIds: plan.chainIds };
      } catch (err) {
        if (err instanceof BudgetExceededException) throw err;
        opts.onEvent?.({
          type: 'notice',
          message: `El modelo de respaldo ${ref.model} no está disponible: ${(err as Error).message}`,
        });
      }
    }
    return null;
  }

  private async attempt(
    agent: AgentWithTools,
    opts: AgentRunOptions,
    prepared: PreparedAgent,
    orgUnitId: string,
    current: {
      resolved: ResolvedModel;
      chainIds: string[];
      history: unknown[];
      routingReason: string | null;
      role: string | null;
    },
    totals: RunTotals,
  ): Promise<AgentRunResult> {
    const ws = agent.workspaceId;
    const { resolved, chainIds } = current;
    const approved = new Set(opts.approvedTools ?? []);
    const result = await resolved.client.run({
      model: resolved.model,
      system: prepared.system,
      effort: agent.effort as Effort,
      history: current.history,
      userMessage: opts.message,
      tools: prepared.tools,
      maxTurns: agent.maxTurns,
      onEvent: opts.onEvent,
      signal: opts.signal,
      // Marcadores de DataGuard estables en todos los turnos de la conversación (o de la ejecución del flujo).
      privacyScope: opts.context.conversationId
        ? `conversation:${opts.context.conversationId}`
        : opts.context.executionId
          ? `execution:${opts.context.executionId}`
          : undefined,
      beforeTurn: () => this.budgets.assertCanSpend(ws, orgUnitId),
      onUsage: async (usage) => {
        const cost = costUsd(usage, resolved.pricing);
        totals.cost += cost;
        totals.inputTokens += usage.inputTokens;
        totals.outputTokens += usage.outputTokens;
        await this.budgets.record(
          {
            workspaceId: ws,
            orgUnitId,
            agentId: agent.id,
            ...opts.context,
            routingReason: current.routingReason,
            role: current.role,
          },
          chainIds,
          resolved.providerId,
          resolved.model,
          usage,
          cost,
        );
      },
      executeTool: (call) => this.executeTool(agent, prepared, approved, call),
    });
    return { ...result, providerId: resolved.providerId, model: resolved.model, costUsd: totals.cost };
  }

  private async executeTool(
    agent: AgentWithTools,
    prepared: PreparedAgent,
    approved: Set<string>,
    call: ToolCall,
  ): Promise<ToolOutcome> {
    if (call.name === LOAD_SKILL_TOOL && prepared.skills.length) return this.loadSkill(prepared, call.input);
    if (call.name === SEARCH_KNOWLEDGE_TOOL && prepared.knowledgeBaseIds.length) {
      return this.searchKnowledge(agent, prepared, call.input);
    }
    if (call.name === SAVE_KNOWLEDGE_TOOL && prepared.writableKnowledgeBaseIds.length) {
      return this.saveKnowledge(agent, prepared, call.input);
    }
    const binding = prepared.bindings.get(call.name);
    if (!binding) return { content: `Tool desconocida: ${call.name}`, isError: true };
    if (binding.requiresApproval && !approved.has(call.name)) {
      return {
        content: `APROBACIÓN REQUERIDA: la acción "${call.name}" necesita confirmación del usuario. Explique qué hará y pida autorización.`,
        isError: true,
      };
    }
    try {
      const result = await this.connectors.invoke(binding.operation, call.input);
      const serialized = JSON.stringify({ ok: result.ok, status: result.status, data: result.data });
      return { content: truncate(serialized), isError: !result.ok };
    } catch (err) {
      this.logger.warn(`Tool ${call.name} falló: ${(err as Error).message}`);
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
  }

  /** Herramienta interna: instrucciones completas de una skill del agente (divulgación progresiva). */
  private loadSkill(prepared: PreparedAgent, input: Record<string, unknown>): ToolOutcome {
    const wanted = typeof input?.name === 'string' ? input.name.trim().toLowerCase() : '';
    if (!wanted) return { content: 'Indique "name" con el identificador de la habilidad.', isError: true };
    const skill = prepared.skills.find((s) => s.slug === wanted || s.name.trim().toLowerCase() === wanted);
    if (!skill) {
      return {
        content: `Habilidad no encontrada: ${wanted}. Disponibles: ${prepared.skills.map((s) => s.slug).join(', ')}`,
        isError: true,
      };
    }
    const tools = [...prepared.bindings.entries()]
      .filter(([, b]) => skill.operationIds.includes(b.operation.id))
      .map(([name]) => name);
    const parts = [`# ${skill.name}`, skill.instructions.trim()];
    if (tools.length) parts.push(`Herramientas de esta habilidad: ${tools.join(', ')}`);
    return { content: truncate(parts.join('\n\n')) };
  }

  /** Herramienta interna: búsqueda full-text en las bases de conocimiento asignadas al agente. */
  private async searchKnowledge(
    agent: AgentWithTools,
    prepared: PreparedAgent,
    input: Record<string, unknown>,
  ): Promise<ToolOutcome> {
    const query = typeof input?.query === 'string' ? input.query.trim().slice(0, 500) : '';
    if (!query) return { content: 'Indique "query" con lo que desea buscar.', isError: true };
    try {
      const hits = await this.knowledge.search(
        agent.workspaceId,
        prepared.knowledgeBaseIds,
        query,
        KNOWLEDGE_TOOL_RESULTS,
      );
      if (!hits.length) {
        return { content: `No se encontró información en la base de conocimiento para: "${query}".` };
      }
      const text = hits
        .map((h, i) => `[${i + 1}] Documento: ${h.title} (relevancia ${h.score})\n${h.content}`)
        .join('\n\n---\n\n');
      return { content: truncate(text) };
    } catch (err) {
      this.logger.warn(`search_knowledge falló: ${(err as Error).message}`);
      return { content: `Error al buscar en la base de conocimiento: ${(err as Error).message}`, isError: true };
    }
  }

  /**
   * Herramienta interna: el agente aprende guardando un documento en la primera base escribible que tenga asignada
   * (auto-entrenamiento). El contenido llega ya desenmascarado por DataGuard: es el dato real.
   */
  private async saveKnowledge(
    agent: AgentWithTools,
    prepared: PreparedAgent,
    input: Record<string, unknown>,
  ): Promise<ToolOutcome> {
    const title = typeof input?.title === 'string' ? input.title.trim().slice(0, SAVE_TITLE_MAX) : '';
    const content = typeof input?.content === 'string' ? input.content.trim().slice(0, SAVE_CONTENT_MAX) : '';
    if (!title)
      return { content: 'Error: indique "title" con un título claro de lo que desea recordar.', isError: true };
    if (!content) return { content: 'Error: indique "content" con el contenido a recordar.', isError: true };
    const baseId = prepared.writableKnowledgeBaseIds[0];
    try {
      await this.knowledge.addDocument(agent.workspaceId, baseId, { title, text: content });
      return { content: `Guardado en la base de conocimiento: ${title}` };
    } catch (err) {
      this.logger.warn(`save_knowledge falló: ${(err as Error).message}`);
      return { content: `Error al guardar en la base de conocimiento: ${(err as Error).message}`, isError: true };
    }
  }
}
