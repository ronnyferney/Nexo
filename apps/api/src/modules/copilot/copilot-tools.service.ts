import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { Connector, ConnectorOperation, CopilotProposalKind, Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentAccessService } from '../agent-access/agent-access.service';
import { AgentHealthService } from '../agent-access/agent-health.service';
import type { AgentPermission } from '../agent-access/agent-access.types';
import { normalizeProfile } from '../agents/prompt-composer';
import { CATALOG, findCatalogEntry } from '../connectors/catalog/catalog.index';
import { LlmGatewayService } from '../llm/llm-gateway.service';
import type { ToolCall, ToolOutcome } from '../llm/llm-provider';
import { COPILOT_TOOLS } from './copilot-tools.definitions';
import { formatDocHits, productDocsIndex } from './definition/product-docs';
import {
  changeRefs,
  referenceErrors,
  validateAgentDraft,
  validateChangeProposal,
  type WorkspaceRefs,
} from './proposal.schema';

const MAX_TOOL_OUTPUT = 30_000;
const DEFAULT_FAILURE_DAYS = 30;
const cut = (s: string | null | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n)}…` : (s ?? null));
const json = (v: unknown) => {
  const s = JSON.stringify(v, null, 1);
  return s.length > MAX_TOOL_OUTPUT ? `${s.slice(0, MAX_TOOL_OUTPUT)}…[truncado]` : s;
};

export interface ProposalEvent {
  id: string;
  kind: CopilotProposalKind;
  summary: string;
}

/** Quién usa el Copilot y en qué sesión: todas las herramientas se filtran por este contexto. */
export interface CopilotToolContext {
  auth: AuthContext & { userId: string };
  sessionId: string;
  agentId: string | null;
  onProposal: (p: ProposalEvent) => void;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** ¿La operación tiene efecto (crea/modifica/envía)? Catálogo → su marca; si no, según el tipo de conector. */
export function isWriteOperation(connector: Pick<Connector, 'type' | 'catalogId'>, op: ConnectorOperation): boolean {
  if (connector.catalogId) {
    const fromCatalog = findCatalogEntry(connector.catalogId)?.operations.find((o) => o.key === op.key);
    if (fromCatalog) return fromCatalog.write;
  }
  const def = (op.definition ?? {}) as Record<string, unknown>;
  switch (connector.type) {
    case 'REST':
      return WRITE_METHODS.has(String(def.method ?? 'GET').toUpperCase());
    case 'DATABASE':
      return def.mode === 'write';
    case 'GRAPHQL':
      return /^\s*mutation\b/i.test(String(def.query ?? ''));
    default:
      // SOAP y MCP no declaran efecto: se asume que puede tenerlo (la aprobación humana es la opción segura).
      return true;
  }
}

/**
 * Herramientas internas del Copilot (ADR 0006 D1): solo lectura del workspace (filtrada por workspace y por los
 * agentes que el usuario puede usar) y creación de propuestas validadas. Los errores vuelven al modelo como
 * `isError` para que corrija; nunca se ejecutan cambios sobre los recursos del cliente.
 */
@Injectable()
export class CopilotToolsService {
  private readonly logger = new Logger(CopilotToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AgentAccessService,
    private readonly health: AgentHealthService,
    private readonly gateway: LlmGatewayService,
  ) {}

  async execute(ctx: CopilotToolContext, call: ToolCall): Promise<ToolOutcome> {
    const input = call.input ?? {};
    try {
      switch (call.name) {
        case COPILOT_TOOLS.getAgent:
          return await this.getAgent(ctx, input);
        case COPILOT_TOOLS.getAgentHealth:
          return await this.getAgentHealth(ctx, input);
        case COPILOT_TOOLS.listConnectors:
          return await this.listConnectors(ctx, input);
        case COPILOT_TOOLS.listCatalog:
          return await this.listCatalog(ctx, input);
        case COPILOT_TOOLS.listSkills:
          return await this.listSkills(ctx);
        case COPILOT_TOOLS.listKnowledgeBases:
          return await this.listKnowledgeBases(ctx);
        case COPILOT_TOOLS.getRecentFailures:
          return await this.getRecentFailures(ctx, input);
        case COPILOT_TOOLS.searchProductDocs:
          return this.searchProductDocs(input);
        case COPILOT_TOOLS.proposeAgent:
          return await this.proposeAgent(ctx, input);
        case COPILOT_TOOLS.proposeChanges:
          return await this.proposeChanges(ctx, input);
        default:
          return { content: `Herramienta desconocida: ${call.name}`, isError: true };
      }
    } catch (err) {
      if (err instanceof HttpException) return { content: err.message, isError: true };
      this.logger.warn(`Herramienta ${call.name} del Copilot falló: ${(err as Error).message}`);
      return { content: `Error al ejecutar ${call.name}.`, isError: true };
    }
  }

  private agentIdOf(ctx: CopilotToolContext, input: Record<string, unknown>): string | null {
    const id = typeof input.agentId === 'string' && input.agentId.trim() ? input.agentId.trim() : ctx.agentId;
    return id ?? null;
  }

  /** Verifica USE sobre el agente (404 si no es visible, 403 si falta permiso). */
  private async useAgent(ctx: CopilotToolContext, input: Record<string, unknown>) {
    const agentId = this.agentIdOf(ctx, input);
    if (!agentId) throw new HttpException('Indique "agentId": la sesión no tiene un agente en foco.', 400);
    return { agentId, ...(await this.access.assert(ctx.auth, agentId, 'USE')) };
  }

  private async getAgent(ctx: CopilotToolContext, input: Record<string, unknown>): Promise<ToolOutcome> {
    const { agentId, permission } = await this.useAgent(ctx, input);
    const ws = ctx.auth.workspaceId;
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, workspaceId: ws },
      include: {
        tools: { include: { operation: { include: { connector: true } } } },
        skills: { include: { skill: true } },
        knowledge: { include: { knowledgeBase: { select: { id: true, name: true } } } },
        routines: { orderBy: { createdAt: 'asc' }, take: 20 },
        evalCases: { orderBy: { createdAt: 'asc' }, take: 15, select: { input: true, expected: true, criteria: true } },
        _count: { select: { examples: true, evalCases: true } },
      },
    });
    if (!agent) return { content: 'Agente no encontrado', isError: true };
    const lastRun = await this.prisma.evalRun.findFirst({
      where: { agentId, workspaceId: ws, status: 'SUCCEEDED' },
      orderBy: { createdAt: 'desc' },
      select: { score: true, passed: true, total: true, createdAt: true },
    });
    // Las instrucciones libres solo con permiso de edición (ADR 0007: USE ve la configuración no sensible).
    const canEdit = (['OWNER', 'EDIT'] as AgentPermission[]).includes(permission);
    return {
      content: json({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        myPermission: permission,
        visibility: agent.visibility,
        launchStatus: agent.launchStatus,
        provider: agent.provider,
        model: agent.model,
        effort: agent.effort,
        maxTurns: agent.maxTurns,
        fallbackModels: agent.fallbackModels,
        targetScore: agent.targetScore,
        profile: normalizeProfile(agent.profile),
        ...(canEdit ? { systemPrompt: cut(agent.systemPrompt, 4000) } : {}),
        tools: agent.tools.map((t) => ({
          operationId: t.operationId,
          connector: t.operation.connector.name,
          operation: t.operation.name,
          description: cut(t.operation.description, 200),
          requiresApproval: t.requiresApproval,
          write: isWriteOperation(t.operation.connector, t.operation),
        })),
        skills: agent.skills.map((s) => ({ id: s.skill.id, name: s.skill.name, description: s.skill.description })),
        knowledgeBases: agent.knowledge.map((k) => k.knowledgeBase),
        examplesCount: agent._count.examples,
        evalCasesCount: agent._count.evalCases,
        evalCasesSample: agent.evalCases.map((c) => ({
          input: cut(c.input, 200),
          expected: cut(c.expected, 200),
          criteria: cut(c.criteria, 200),
        })),
        lastEvaluation: lastRun,
        routines: agent.routines.map((r) => ({
          name: r.name,
          schedule: r.schedule,
          timezone: r.timezone,
          enabled: r.enabled,
          lastStatus: r.lastStatus,
        })),
      }),
    };
  }

  private async getAgentHealth(ctx: CopilotToolContext, input: Record<string, unknown>): Promise<ToolOutcome> {
    const { agentId } = await this.useAgent(ctx, input);
    try {
      const health = await this.health.evaluate(ctx.auth.workspaceId, agentId);
      return {
        content: json({
          score: health.score,
          level: health.level,
          failed: health.checks
            .filter((c) => !c.passed)
            .map((c) => ({
              id: c.id,
              category: c.category,
              severity: c.severity,
              message: c.message,
              recommendation: c.recommendation,
            })),
          passed: health.checks.filter((c) => c.passed).map((c) => c.id),
        }),
      };
    } catch (err) {
      this.logger.warn(`Salud del agente no disponible: ${(err as Error).message}`);
      return {
        content:
          'El puntaje de salud no está disponible en este momento. Continúa el análisis con get_agent y get_recent_failures.',
      };
    }
  }

  private async listConnectors(ctx: CopilotToolContext, input: Record<string, unknown>): Promise<ToolOutcome> {
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    const connectors = await this.prisma.connector.findMany({
      where: {
        workspaceId: ctx.auth.workspaceId,
        ...(query ? { name: { contains: query, mode: 'insensitive' as Prisma.QueryMode } } : {}),
      },
      include: { operations: { orderBy: { key: 'asc' }, take: 60 } },
      orderBy: { name: 'asc' },
      take: 50,
    });
    if (!connectors.length) {
      return { content: 'El workspace no tiene conectores instalados. Revisa list_catalog para integraciones listas.' };
    }
    return {
      content: json(
        connectors.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          catalogId: c.catalogId,
          description: cut(c.description, 200),
          operations: c.operations.map((op) => ({
            id: op.id,
            key: op.key,
            name: op.name,
            description: cut(op.description, 240),
            write: isWriteOperation(c, op),
          })),
        })),
      ),
    };
  }

  private async listCatalog(ctx: CopilotToolContext, input: Record<string, unknown>): Promise<ToolOutcome> {
    const category = typeof input.category === 'string' ? input.category : undefined;
    const counts = await this.prisma.connector.groupBy({
      by: ['catalogId'],
      where: { workspaceId: ctx.auth.workspaceId, catalogId: { not: null } },
      _count: { _all: true },
    });
    const installed = new Map(counts.map((c) => [c.catalogId, c._count._all]));
    return {
      content: json(
        CATALOG.filter((e) => !category || e.category === category).map((e) => ({
          id: e.id,
          name: e.name,
          category: e.category,
          description: cut(e.description, 240),
          installed: installed.get(e.id) ?? 0,
          operations: e.operations.map((o) => ({ key: o.key, name: o.name, write: o.write })),
        })),
      ),
    };
  }

  private async listSkills(ctx: CopilotToolContext): Promise<ToolOutcome> {
    const skills = await this.prisma.skill.findMany({
      where: { workspaceId: ctx.auth.workspaceId },
      select: { id: true, name: true, slug: true, description: true, operationIds: true },
      orderBy: { name: 'asc' },
      take: 100,
    });
    if (!skills.length) return { content: 'El workspace aún no tiene skills.' };
    return {
      content: json(
        skills.map((s) => ({ ...s, description: cut(s.description, 240), operationIds: s.operationIds.length })),
      ),
    };
  }

  private async listKnowledgeBases(ctx: CopilotToolContext): Promise<ToolOutcome> {
    const bases = await this.prisma.knowledgeBase.findMany({
      where: { workspaceId: ctx.auth.workspaceId },
      select: { id: true, name: true, description: true, _count: { select: { documents: true } } },
      orderBy: { name: 'asc' },
      take: 100,
    });
    if (!bases.length) return { content: 'El workspace aún no tiene bases de conocimiento.' };
    return {
      content: json(
        bases.map((b) => ({
          id: b.id,
          name: b.name,
          description: cut(b.description, 240),
          documents: b._count.documents,
        })),
      ),
    };
  }

  private async getRecentFailures(ctx: CopilotToolContext, input: Record<string, unknown>): Promise<ToolOutcome> {
    const { agentId, permission, agent } = await this.useAgent(ctx, input);
    const ws = ctx.auth.workspaceId;
    const days = Math.min(Math.max(Number(input.days) || DEFAULT_FAILURE_DAYS, 1), 90);
    const since = new Date(Date.now() - days * 86_400_000);
    // ADR 0007 D4: el contenido del feedback solo lo revisa quien tiene EDIT sobre el agente.
    const canReview = (['OWNER', 'EDIT'] as AgentPermission[]).includes(permission);

    const [negative, negativeCount, lastRun, failedRoutines, budgetAlerts] = await Promise.all([
      canReview
        ? this.prisma.messageFeedback.findMany({
            where: { agentId, workspaceId: ws, rating: 'DOWN', createdAt: { gte: since } },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
              userMessage: true,
              agentResponse: true,
              comment: true,
              correction: true,
              status: true,
              createdAt: true,
            },
          })
        : Promise.resolve([]),
      this.prisma.messageFeedback.count({
        where: { agentId, workspaceId: ws, rating: 'DOWN', createdAt: { gte: since } },
      }),
      this.prisma.evalRun.findFirst({
        where: { agentId, workspaceId: ws, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        include: { results: { where: { passed: false }, take: 10, orderBy: { createdAt: 'asc' } } },
      }),
      this.prisma.routineRun.findMany({
        where: { routine: { agentId, workspaceId: ws }, status: 'FAILED', startedAt: { gte: since } },
        orderBy: { startedAt: 'desc' },
        take: 10,
        include: { routine: { select: { name: true } } },
      }),
      this.prisma.budgetAlert.findMany({
        where: {
          orgUnit: { workspaceId: ws },
          threshold: { gte: 100 },
          createdAt: { gte: since },
          ...(agent.costCenterId ? { orgUnitId: agent.costCenterId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { orgUnit: { select: { name: true } } },
      }),
    ]);

    const budgetErrors = [
      ...(lastRun?.error && /presupuesto/i.test(lastRun.error) ? [`Evaluación: ${cut(lastRun.error, 300)}`] : []),
      ...failedRoutines
        .filter((r) => /presupuesto/i.test(r.error ?? ''))
        .map((r) => `Rutina "${r.routine.name}": ${cut(r.error, 300)}`),
      ...budgetAlerts.map((a) => `Presupuesto agotado en "${a.orgUnit.name}" (periodo ${a.periodKey})`),
    ];

    return {
      content: json({
        windowDays: days,
        negativeFeedback: {
          count: negativeCount,
          ...(canReview
            ? {
                items: negative.map((f) => ({
                  userMessage: cut(f.userMessage, 300),
                  agentResponse: cut(f.agentResponse, 300),
                  comment: cut(f.comment, 300),
                  correction: cut(f.correction, 300),
                  status: f.status,
                  createdAt: f.createdAt,
                })),
              }
            : { note: 'El detalle del feedback solo es visible con permiso de edición sobre el agente.' }),
        },
        lastEvaluation: lastRun
          ? {
              status: lastRun.status,
              score: lastRun.score,
              passed: lastRun.passed,
              total: lastRun.total,
              targetScore: agent.targetScore,
              error: cut(lastRun.error, 300),
              failedCases: lastRun.results.map((r) => ({
                input: cut(r.input, 300),
                expected: cut(r.expected, 300),
                output: cut(r.output, 300),
                score: r.humanScore ?? r.score,
                reasoning: cut(r.reasoning, 300),
              })),
            }
          : null,
        failedRoutineRuns: failedRoutines.map((r) => ({
          routine: r.routine.name,
          error: cut(r.error, 300),
          startedAt: r.startedAt,
        })),
        budgetErrors,
      }),
    };
  }

  private searchProductDocs(input: Record<string, unknown>): ToolOutcome {
    const query = typeof input.query === 'string' ? input.query.trim().slice(0, 300) : '';
    if (!query) return { content: 'Indique "query" con lo que desea buscar.', isError: true };
    return { content: formatDocHits(query, productDocsIndex().search(query, 4)) };
  }

  /** Recursos existentes del workspace para verificar las referencias de una propuesta. */
  async workspaceRefs(workspaceId: string): Promise<WorkspaceRefs> {
    const [catalog, operations, skills, bases] = await Promise.all([
      this.gateway.catalog(workspaceId),
      this.prisma.connectorOperation.findMany({ where: { connector: { workspaceId } }, select: { id: true } }),
      this.prisma.skill.findMany({ where: { workspaceId }, select: { id: true } }),
      this.prisma.knowledgeBase.findMany({ where: { workspaceId }, select: { id: true } }),
    ]);
    return {
      models: new Set(catalog.filter((c) => c.configured).flatMap((c) => c.models.map((m) => `${c.id}:${m.id}`))),
      operationIds: new Set(operations.map((o) => o.id)),
      skillIds: new Set(skills.map((s) => s.id)),
      knowledgeBaseIds: new Set(bases.map((b) => b.id)),
      catalogIds: new Set(CATALOG.map((e) => e.id)),
    };
  }

  private invalid(errors: string[]): ToolOutcome {
    return {
      content: `Propuesta rechazada por validación. Corrige y vuelve a intentarlo:\n- ${errors.join('\n- ')}`,
      isError: true,
    };
  }

  private async proposeAgent(ctx: CopilotToolContext, input: Record<string, unknown>): Promise<ToolOutcome> {
    const parsed = validateAgentDraft(input);
    if (!parsed.ok) return this.invalid(parsed.errors);
    const refErrors = referenceErrors(parsed.value, await this.workspaceRefs(ctx.auth.workspaceId));
    if (refErrors.length) return this.invalid(refErrors);
    const proposal = await this.prisma.copilotProposal.create({
      data: {
        sessionId: ctx.sessionId,
        workspaceId: ctx.auth.workspaceId,
        kind: 'CREATE_AGENT',
        summary: parsed.value.summary,
        payload: parsed.value as unknown as Prisma.InputJsonValue,
      },
    });
    ctx.onProposal({ id: proposal.id, kind: proposal.kind, summary: proposal.summary });
    return {
      content: `Propuesta ${proposal.id} creada. El usuario la revisará y decidirá si la aplica; no se creó ningún recurso todavía.`,
    };
  }

  private async proposeChanges(ctx: CopilotToolContext, input: Record<string, unknown>): Promise<ToolOutcome> {
    const parsed = validateChangeProposal(input);
    if (!parsed.ok) return this.invalid(parsed.errors);
    // Proponer requiere USE; aplicar exigirá EDIT (ADR 0007).
    await this.access.assert(ctx.auth, parsed.value.agentId, 'USE');
    const refErrors = referenceErrors(changeRefs(parsed.value.changes), await this.workspaceRefs(ctx.auth.workspaceId));
    if (refErrors.length) return this.invalid(refErrors);
    const proposal = await this.prisma.copilotProposal.create({
      data: {
        sessionId: ctx.sessionId,
        workspaceId: ctx.auth.workspaceId,
        agentId: parsed.value.agentId,
        kind: 'UPDATE_AGENT',
        summary: parsed.value.summary,
        payload: parsed.value.changes as unknown as Prisma.InputJsonValue,
      },
    });
    ctx.onProposal({ id: proposal.id, kind: proposal.kind, summary: proposal.summary });
    return {
      content: `Propuesta de cambios ${proposal.id} creada. El usuario la revisará y decidirá si la aplica (requiere permiso de edición).`,
    };
  }
}
