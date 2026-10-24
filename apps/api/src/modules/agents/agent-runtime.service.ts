import { HttpException, Injectable, Logger } from '@nestjs/common';
import type {
  Agent,
  AgentExample,
  AgentKnowledge,
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
import { costUsd } from '../llm/pricing';
import { composeSystemPrompt, LOAD_SKILL_TOOL, SEARCH_KNOWLEDGE_TOOL } from './prompt-composer';

const MAX_TOOL_OUTPUT = 50_000;
/** Fragmentos que devuelve `search_knowledge`. */
const KNOWLEDGE_TOOL_RESULTS = 5;

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
 * (conectores, operaciones de skills e internas `load_skill`/`search_knowledge`), delega el bucle al proveedor,
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
  ) {}

  /** System prompt y herramientas del agente, en orden estable (favorece la caché de prompts). */
  async prepare(agent: AgentWithTools): Promise<PreparedAgent> {
    const skills = (agent.skills ?? []).map((s) => s.skill).sort((a, b) => a.slug.localeCompare(b.slug));
    const bases = (agent.knowledge ?? []).map((k) => k.knowledgeBase);

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

    const system = composeSystemPrompt({
      systemPrompt: agent.systemPrompt,
      profile: agent.profile as Record<string, unknown>,
      skills,
      knowledgeBases: bases,
      examples: agent.examples ?? [],
    });
    return { system, tools, bindings, skills, knowledgeBaseIds: bases.map((b) => b.id) };
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
  async run(agent: AgentWithTools, opts: AgentRunOptions): Promise<AgentRunResult> {
    const ws = agent.workspaceId;
    const orgUnitId = await this.org.resolveCostCenter(ws, opts.context.userId, agent.costCenterId);
    const prepared = await this.prepare(agent);

    const plan = await this.budgets.plan(ws, orgUnitId, agent.provider, agent.model);
    if (plan.notice) opts.onEvent?.({ type: 'notice', message: plan.notice });
    const fallbacks = (agent.fallbackModels ?? []).map(parseModelRef).filter((r) => r !== null);
    let primary: ResolvedModel;
    let start: { index: number; chainIds: string[] } | null = null;
    try {
      primary = await this.gateway.resolve(ws, plan.providerId, plan.model);
    } catch (err) {
      // Principal no disponible (sesión cerrada, deshabilitado, modelo eliminado): se arranca con el primer respaldo.
      if (!(err instanceof ConnectionUnavailableException)) throw err;
      const next = await this.nextFallback(ws, orgUnitId, fallbacks, 0, opts);
      if (!next) throw err;
      opts.onEvent?.({
        type: 'notice',
        message: `El modelo ${plan.model} no está disponible (${err.message}); se usa ${label(next.resolved)}.`,
      });
      primary = next.resolved;
      start = { index: next.index, chainIds: next.chainIds };
    }

    let history = opts.history ?? [];
    if (history.length && opts.historyProviderId && opts.historyProviderId !== primary.providerId) {
      opts.onEvent?.({
        type: 'notice',
        message: 'El proveedor cambió; se inicia un historial nuevo para esta respuesta.',
      });
      history = [];
    }

    const totals = { cost: 0 };
    let current = { resolved: primary, chainIds: start?.chainIds ?? plan.chainIds, history };
    let failed = label(primary);
    for (let i = start ? start.index + 1 : 0; ; i++) {
      try {
        return await this.attempt(agent, opts, prepared, orgUnitId, current, totals);
      } catch (err) {
        if (!isProviderFailure(err, opts.signal)) throw err;
        this.logger.warn(`Modelo ${failed} falló para el agente ${agent.id}: ${(err as Error).message}`);
        const next = await this.nextFallback(ws, orgUnitId, fallbacks, i, opts);
        if (!next) throw err;
        i = next.index;
        opts.onEvent?.({ type: 'notice', message: `El modelo ${failed} falló; se usa ${label(next.resolved)}.` });
        current = {
          resolved: next.resolved,
          chainIds: next.chainIds,
          history: next.resolved.kind === primary.kind ? history : [],
        };
        failed = label(next.resolved);
      }
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
    current: { resolved: ResolvedModel; chainIds: string[]; history: unknown[] },
    totals: { cost: number },
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
      beforeTurn: () => this.budgets.assertCanSpend(ws, orgUnitId),
      onUsage: async (usage) => {
        const cost = costUsd(usage, resolved.pricing);
        totals.cost += cost;
        await this.budgets.record(
          { workspaceId: ws, orgUnitId, agentId: agent.id, ...opts.context },
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
}
