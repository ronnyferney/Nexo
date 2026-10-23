import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, PromptSuggestion } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentsService } from '../agents/agents.service';
import { OrgService } from '../governance/org.service';
import { CreateSuggestionDto } from './dto/training.dto';
import {
  buildOptimizerMessage,
  effectiveScore,
  MAX_OPTIMIZER_CASES,
  OPTIMIZER_SYSTEM_PROMPT,
  parseProposal,
  type Proposal,
} from './eval-protocol';
import { MeteredLlmService } from './metered-llm.service';
import { VersionsService } from './versions.service';

const view = (s: PromptSuggestion) => ({
  id: s.id,
  agentId: s.agentId,
  runId: s.runId,
  status: s.status,
  rationale: s.rationale,
  proposal: s.proposal as Proposal,
  decidedAt: s.decidedAt,
  createdAt: s.createdAt,
});

/** Sugerencias de mejora asistidas por IA con aprobación humana (ADR 0004, D4). */
@Injectable()
export class SuggestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
    private readonly org: OrgService,
    private readonly llm: MeteredLlmService,
    private readonly versions: VersionsService,
  ) {}

  /** Analiza los casos fallidos o dudosos de una corrida terminada y guarda la propuesta del modelo (PENDING). */
  async create(workspaceId: string, runId: string, userId: string | undefined, dto: CreateSuggestionDto) {
    const run = await this.prisma.evalRun.findFirst({
      where: { id: runId, workspaceId },
      include: { results: { orderBy: { createdAt: 'asc' } } },
    });
    if (!run) throw new NotFoundException('Corrida de evaluación no encontrada');
    if (run.status === 'QUEUED' || run.status === 'RUNNING') {
      throw new ConflictException('La corrida aún está en curso; espere a que termine');
    }
    const weak = run.results
      .filter((r) => {
        const s = effectiveScore(r);
        return s === null || s < run.passThreshold || (r.needsReview && r.humanScore === null);
      })
      .slice(0, MAX_OPTIMIZER_CASES);
    if (!weak.length) throw new BadRequestException('La corrida no tiene casos fallidos ni dudosos que analizar');

    const agent = await this.agents.get(workspaceId, run.agentId);
    const orgUnitId = await this.org.resolveCostCenter(workspaceId, undefined, agent.costCenterId);
    const res = await this.llm.complete({
      workspaceId,
      orgUnitId,
      providerId: dto.providerId,
      model: dto.model,
      agentId: agent.id,
      userId,
      system: OPTIMIZER_SYSTEM_PROMPT,
      userMessage: buildOptimizerMessage(
        agent,
        weak.map((r) => ({ input: r.input, expected: r.expected, output: r.output, reasoning: r.reasoning })),
      ),
    });
    const parsed = parseProposal(res.text);
    if (!parsed) {
      throw new BadGatewayException(
        'El modelo no devolvió una propuesta válida (se esperaba JSON con "systemPrompt" o "profile")',
      );
    }
    const created = await this.prisma.promptSuggestion.create({
      data: {
        agentId: agent.id,
        runId: run.id,
        rationale: parsed.rationale,
        proposal: parsed.proposal as Prisma.InputJsonValue,
      },
    });
    return { ...view(created), costUsd: res.costUsd };
  }

  async list(workspaceId: string, agentId: string) {
    await this.agents.get(workspaceId, agentId);
    const rows = await this.prisma.promptSuggestion.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(view);
  }

  /** Aplica la propuesta: guarda antes la versión actual, actualiza el agente y marca la sugerencia APPLIED. */
  async apply(workspaceId: string, id: string, userId: string | undefined) {
    const s = await this.get(workspaceId, id);
    if (s.status !== 'PENDING') throw new ConflictException('La sugerencia ya fue decidida');
    const proposal = s.proposal as Proposal;
    const previous = await this.versions.ensureCurrent(
      workspaceId,
      s.agentId,
      userId,
      'Respaldo automático antes de aplicar una sugerencia',
    );
    await this.prisma.$transaction(async (tx) => {
      const decided = await tx.promptSuggestion.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'APPLIED', decidedById: userId ?? null, decidedAt: new Date() },
      });
      if (!decided.count) throw new ConflictException('La sugerencia ya fue decidida');
      await tx.agent.update({
        where: { id: s.agentId },
        data: {
          ...(proposal.systemPrompt !== undefined ? { systemPrompt: proposal.systemPrompt } : {}),
          ...(proposal.profile !== undefined ? { profile: proposal.profile as Prisma.InputJsonValue } : {}),
        },
      });
    });
    return {
      suggestion: view(await this.prisma.promptSuggestion.findUniqueOrThrow({ where: { id } })),
      previousVersion: { id: previous.version.id, version: previous.version.version },
      agent: await this.agents.describe(workspaceId, s.agentId),
    };
  }

  async reject(workspaceId: string, id: string, userId: string | undefined) {
    await this.get(workspaceId, id);
    const decided = await this.prisma.promptSuggestion.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', decidedById: userId ?? null, decidedAt: new Date() },
    });
    if (!decided.count) throw new ConflictException('La sugerencia ya fue decidida');
    return view(await this.prisma.promptSuggestion.findUniqueOrThrow({ where: { id } }));
  }

  private async get(workspaceId: string, id: string) {
    const s = await this.prisma.promptSuggestion.findFirst({ where: { id, agent: { workspaceId } } });
    if (!s) throw new NotFoundException('Sugerencia no encontrada');
    return s;
  }
}
