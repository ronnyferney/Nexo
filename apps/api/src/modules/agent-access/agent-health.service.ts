import { Injectable, NotFoundException } from '@nestjs/common';
import type { ConnectorType, ModelTier } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { findCatalogEntry } from '../connectors/catalog/catalog.index';
import { LlmGatewayService } from '../llm/llm-gateway.service';
import { normalizeProfile } from '../agents/prompt-composer';
import type { AgentHealth } from './agent-access.types';
import { computeHealth, ROUTINE_WINDOW_DAYS, type HealthFacts, type HealthTool } from './agent-health.rules';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * ¿La operación crea o modifica datos? Prioridad: marca `write` del catálogo (ADR 0005) → `mode: 'write'` (bases de
 * datos) → método HTTP de escritura (REST) → mutación (GraphQL). SOAP y MCP sin marca se consideran de lectura.
 */
export function isWriteOperation(
  connector: { type: ConnectorType; catalogId: string | null },
  op: { key: string; definition: unknown },
): boolean {
  if (connector.catalogId) {
    const entry = findCatalogEntry(connector.catalogId)?.operations.find((o) => o.key === op.key);
    if (entry) return entry.write;
  }
  const def = (op.definition ?? {}) as Record<string, unknown>;
  if (def.mode === 'write') return true;
  if (def.write === true) return true;
  if (connector.type === 'REST' || connector.type === 'DATABASE') {
    return typeof def.method === 'string' && WRITE_METHODS.has(def.method.toUpperCase());
  }
  if (connector.type === 'GRAPHQL') return typeof def.query === 'string' && /^\s*mutation\b/i.test(def.query);
  return false;
}

/** Contrato compartido (ADR 0006 D3). Reglas deterministas, sin costo de IA (ver `agent-health.rules.ts`). */
@Injectable()
export class AgentHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: LlmGatewayService,
  ) {}

  async evaluate(workspaceId: string, agentId: string): Promise<AgentHealth> {
    return this.evaluateWith(workspaceId, agentId, await this.tiers(workspaceId));
  }

  private async evaluateWith(workspaceId: string, agentId: string, tiers: Map<string, ModelTier>) {
    const facts = await this.facts(workspaceId, agentId, tiers);
    return { agentId, ...computeHealth(facts), evaluatedAt: new Date().toISOString() };
  }

  /** Evalúa varios agentes (resúmenes). Los inexistentes se omiten. */
  async evaluateMany(workspaceId: string, agentIds: string[]): Promise<AgentHealth[]> {
    const out: AgentHealth[] = [];
    const tiers = await this.tiers(workspaceId); // el catálogo se lee una sola vez
    for (const id of agentIds) {
      try {
        out.push(await this.evaluateWith(workspaceId, id, tiers));
      } catch (err) {
        if (!(err instanceof NotFoundException)) throw err;
      }
    }
    return out;
  }

  /** Puntaje de la última corrida de evaluación terminada con puntaje (null si nunca se evaluó). */
  async latestEvalScore(workspaceId: string, agentId: string): Promise<number | null> {
    const run = await this.prisma.evalRun.findFirst({
      where: { agentId, workspaceId, status: 'SUCCEEDED', score: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { score: true },
    });
    return run?.score ?? null;
  }

  private async facts(workspaceId: string, agentId: string, tiers: Map<string, ModelTier>): Promise<HealthFacts> {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, workspaceId },
      include: {
        tools: { include: { operation: { include: { connector: true } } } },
        skills: { include: { skill: { select: { operationIds: true } } } },
        _count: { select: { knowledge: true, evalCases: true } },
      },
    });
    if (!agent) throw new NotFoundException('Agente no encontrado');

    const tools: HealthTool[] = agent.tools.map((t) => ({
      name: `${t.operation.connector.name} · ${t.operation.name}`,
      description: t.operation.description,
      write: isWriteOperation(t.operation.connector, t.operation),
      requiresApproval: t.requiresApproval,
    }));
    // Las operaciones que aporta una skill se suman sin aprobación humana (ver AgentRuntimeService.prepare).
    const bound = new Set(agent.tools.map((t) => t.operationId));
    const skillOpIds = [...new Set(agent.skills.flatMap((s) => s.skill.operationIds))].filter((id) => !bound.has(id));
    if (skillOpIds.length) {
      const ops = await this.prisma.connectorOperation.findMany({
        where: { id: { in: skillOpIds }, connector: { workspaceId } },
        include: { connector: true },
      });
      for (const op of ops) {
        tools.push({
          name: `${op.connector.name} · ${op.name}`,
          description: op.description,
          write: isWriteOperation(op.connector, op),
          requiresApproval: false,
        });
      }
    }

    const since = new Date(Date.now() - ROUTINE_WINDOW_DAYS * 24 * 3600 * 1000);
    const [latestEvalScore, pendingNegativeFeedback, failedRoutineRuns] = await Promise.all([
      this.latestEvalScore(workspaceId, agentId),
      this.prisma.messageFeedback.count({ where: { workspaceId, agentId, status: 'PENDING', rating: 'DOWN' } }),
      this.prisma.routineRun.count({
        where: { status: 'FAILED', startedAt: { gte: since }, routine: { agentId, workspaceId } },
      }),
    ]);
    const modelTier = tiers.get(`${agent.provider}:${agent.model}`) ?? null;
    const profile = normalizeProfile(agent.profile);
    return {
      profile: {
        role: profile.role ?? '',
        goals: profile.goals ?? [],
        responsibilities: profile.responsibilities ?? [],
        boundaries: profile.boundaries ?? [],
        tone: profile.tone ?? '',
        outputFormat: profile.outputFormat ?? '',
      },
      systemPrompt: agent.systemPrompt ?? '',
      tools,
      knowledgeBases: agent._count.knowledge,
      evalCases: agent._count.evalCases,
      latestEvalScore,
      targetScore: agent.targetScore ?? 0.85,
      pendingNegativeFeedback,
      modelTier,
      effort: agent.effort,
      failedRoutineRuns,
      fallbackModels: agent.fallbackModels.length,
    };
  }

  /** Nivel de cada modelo del catálogo del workspace (`"<proveedor>:<modelo>"` → tier), incluidos los deshabilitados. */
  private async tiers(workspaceId: string): Promise<Map<string, ModelTier>> {
    try {
      const catalog = await this.gateway.catalog(workspaceId, true);
      return new Map(catalog.flatMap((c) => c.models.map((m) => [`${c.id}:${m.id}`, m.tier] as const)));
    } catch {
      return new Map();
    }
  }
}
