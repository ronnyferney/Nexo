import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { EvalResult, EvalRun } from '@prisma/client';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentsService, targetScoreOf } from '../agents/agents.service';
import { LlmGatewayService } from '../llm/llm-gateway.service';
import { CreateEvalRunDto, ReviewEvalResultDto } from './dto/training.dto';
import { DEFAULT_PASS_THRESHOLD, effectiveScore, summarizeResults } from './eval-protocol';
import { EVAL_QUEUE, JOB_EVAL_RUN, type EvalRunJobData } from './queue/eval-queue.constants';
import { VersionsService } from './versions.service';

const RUNS_LIMIT = 50;

type RunWithVersion = EvalRun & { version: { version: number } | null };

export const runView = (r: RunWithVersion) => ({
  id: r.id,
  agentId: r.agentId,
  status: r.status,
  versionId: r.versionId,
  version: r.version?.version ?? null,
  score: r.score,
  passed: r.passed,
  total: r.total,
  passThreshold: r.passThreshold,
  costUsd: Number(r.costUsd),
  judgeProviderId: r.judgeProviderId,
  judgeModel: r.judgeModel,
  error: r.error,
  createdAt: r.createdAt,
  finishedAt: r.finishedAt,
});

export const resultView = (r: EvalResult) => ({
  id: r.id,
  caseId: r.caseId,
  input: r.input,
  expected: r.expected,
  output: r.output,
  score: r.score,
  passed: r.passed,
  reasoning: r.reasoning,
  needsReview: r.needsReview,
  humanScore: r.humanScore,
  humanNote: r.humanNote,
  effectiveScore: effectiveScore(r),
});

const WITH_VERSION = { version: { select: { version: true } } } as const;

/** Corridas de evaluación (ADR 0004, D2): creación y encolado, consulta y revisión humana de resultados. */
@Injectable()
export class EvalsService {
  private readonly logger = new Logger(EvalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
    private readonly gateway: LlmGatewayService,
    private readonly versions: VersionsService,
    @InjectQueue(EVAL_QUEUE) private readonly queue: Queue,
  ) {}

  async create(workspaceId: string, agentId: string, userId: string | undefined, dto: CreateEvalRunDto) {
    await this.agents.get(workspaceId, agentId);
    const total = await this.prisma.evalCase.count({ where: { agentId } });
    if (!total) throw new BadRequestException('El agente no tiene casos de evaluación: cree al menos uno');
    // El juez debe existir y estar habilitado en el catálogo del workspace (lanza 400 si no).
    await this.gateway.resolve(workspaceId, dto.judgeProviderId, dto.judgeModel);

    const { version } = await this.versions.ensureCurrent(workspaceId, agentId, userId, dto.versionNote);
    const run = await this.prisma.evalRun.create({
      data: {
        agentId,
        workspaceId,
        versionId: version.id,
        judgeProviderId: dto.judgeProviderId,
        judgeModel: dto.judgeModel,
        passThreshold: dto.passThreshold ?? DEFAULT_PASS_THRESHOLD,
        total,
      },
      include: WITH_VERSION,
    });
    try {
      await this.queue.add(JOB_EVAL_RUN, { runId: run.id } satisfies EvalRunJobData, {
        jobId: run.id,
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    } catch (err) {
      this.logger.error(`No se pudo encolar la corrida ${run.id}: ${(err as Error).message}`);
      await this.prisma.evalRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: 'No se pudo encolar la corrida', finishedAt: new Date() },
      });
      throw new ServiceUnavailableException('No se pudo encolar la corrida de evaluación; intente de nuevo');
    }
    return runView(run);
  }

  async list(workspaceId: string, agentId: string) {
    await this.agents.get(workspaceId, agentId);
    const runs = await this.prisma.evalRun.findMany({
      where: { agentId, workspaceId },
      include: WITH_VERSION,
      orderBy: { createdAt: 'desc' },
      take: RUNS_LIMIT,
    });
    return runs.map(runView);
  }

  async get(workspaceId: string, id: string) {
    const run = await this.prisma.evalRun.findFirst({
      where: { id, workspaceId },
      include: { ...WITH_VERSION, results: { orderBy: { createdAt: 'asc' } } },
    });
    if (!run) throw new NotFoundException('Corrida de evaluación no encontrada');
    return { ...runView(run), results: run.results.map(resultView) };
  }

  /** Revisión humana de un resultado: recalcula `passed` del resultado y `score`/`passed` de la corrida. */
  async reviewResult(workspaceId: string, id: string, dto: ReviewEvalResultDto) {
    const result = await this.prisma.evalResult.findFirst({
      where: { id, run: { workspaceId } },
      include: { run: true },
    });
    if (!result) throw new NotFoundException('Resultado de evaluación no encontrado');
    if (result.run.status === 'QUEUED' || result.run.status === 'RUNNING') {
      throw new ConflictException('La corrida aún está en curso; espere a que termine para revisar');
    }
    const humanScore = dto.humanScore;
    const effective = humanScore ?? result.score;
    await this.prisma.$transaction(async (tx) => {
      await tx.evalResult.update({
        where: { id },
        data: {
          humanScore,
          ...(dto.humanNote !== undefined ? { humanNote: dto.humanNote.trim() || null } : {}),
          passed: effective !== null && effective >= result.run.passThreshold,
        },
      });
      const all = await tx.evalResult.findMany({
        where: { runId: result.runId },
        select: { score: true, humanScore: true },
      });
      const summary = summarizeResults(all, result.run.passThreshold);
      await tx.evalRun.update({ where: { id: result.runId }, data: summary });
    });
    const updated = await this.prisma.evalResult.findUniqueOrThrow({ where: { id } });
    const run = await this.prisma.evalRun.findUniqueOrThrow({ where: { id: result.runId }, include: WITH_VERSION });
    return { result: resultView(updated), run: runView(run) };
  }

  /** Resumen del ciclo de mejora del agente (ADR 0004). */
  async summary(workspaceId: string, agentId: string) {
    const agent = await this.agents.get(workspaceId, agentId);
    const [succeeded, pendingFeedback, evalCases, examples] = await Promise.all([
      this.prisma.evalRun.findMany({
        where: { agentId, workspaceId, status: 'SUCCEEDED' },
        include: WITH_VERSION,
        orderBy: { createdAt: 'desc' },
        take: RUNS_LIMIT,
      }),
      this.prisma.messageFeedback.count({ where: { workspaceId, agentId, status: 'PENDING' } }),
      this.prisma.evalCase.count({ where: { agentId } }),
      this.prisma.agentExample.count({ where: { agentId } }),
    ]);
    const runs = succeeded.reverse().map((r) => ({
      id: r.id,
      version: r.version?.version ?? null,
      score: r.score,
      createdAt: r.createdAt,
    }));
    const scored = runs.filter((r) => r.score !== null);
    const best = scored.reduce<(typeof runs)[number] | null>((b, r) => (!b || r.score! > b.score! ? r : b), null);
    return {
      targetScore: targetScoreOf(agent),
      latestScore: scored.length ? scored[scored.length - 1].score : null,
      bestScore: best?.score ?? null,
      bestVersion: best?.version ?? null,
      runs,
      pendingFeedback,
      evalCases,
      examples,
    };
  }
}
