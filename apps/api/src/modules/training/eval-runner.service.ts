import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type EvalCase, type EvalRun } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentsService } from '../agents/agents.service';
import { BudgetExceededException } from '../governance/budget.errors';
import { OrgService } from '../governance/org.service';
import {
  buildJudgeMessage,
  JUDGE_SYSTEM_PROMPT,
  needsReview,
  parseJudgeResponse,
  summarizeResults,
} from './eval-protocol';
import { MeteredLlmService } from './metered-llm.service';
import { EVAL_CASE_CONCURRENCY } from './queue/eval-queue.constants';

/** Errores que invalidan la corrida completa (no solo un caso): presupuesto agotado o modelo no permitido. */
const isFatal = (err: unknown) => err instanceof BudgetExceededException || err instanceof ForbiddenException;

/** Ejecuta `fn` sobre los elementos con a lo sumo `limit` en paralelo. */
export async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Worker de una corrida de evaluación (ADR 0004, D2): ejecuta el agente sobre cada caso (sin historial, `source: EVAL`)
 * y califica la salida con el juez IA. Un presupuesto agotado deja la corrida FAILED con el mensaje del gobierno de
 * costos; el costo ya consumido (agente + juez) queda acumulado en la corrida.
 */
@Injectable()
export class EvalRunnerService {
  private readonly logger = new Logger(EvalRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
    private readonly org: OrgService,
    private readonly llm: MeteredLlmService,
  ) {}

  /** Idempotente: solo procesa corridas en estado QUEUED. */
  async execute(runId: string): Promise<void> {
    const claimed = await this.prisma.evalRun.updateMany({
      where: { id: runId, status: 'QUEUED' },
      data: { status: 'RUNNING' },
    });
    if (!claimed.count) return;
    const run = await this.prisma.evalRun.findUniqueOrThrow({ where: { id: runId } });

    const totals = { cost: 0 };
    let fatal: Error | null = null;
    try {
      const agent = await this.agents.get(run.workspaceId, run.agentId);
      const cases = await this.prisma.evalCase.findMany({
        where: { agentId: run.agentId },
        orderBy: { createdAt: 'asc' },
      });
      if (!cases.length) throw new Error('El agente no tiene casos de evaluación');
      await this.prisma.evalRun.update({ where: { id: runId }, data: { total: cases.length } });
      const orgUnitId = await this.org.resolveCostCenter(run.workspaceId, undefined, agent.costCenterId);

      await runPool(cases, EVAL_CASE_CONCURRENCY, async (c) => {
        if (fatal) return;
        try {
          await this.evaluateCase(run, c, orgUnitId, totals);
        } catch (err) {
          // Fatal (presupuesto, modelo no permitido) o inesperado: detiene los casos restantes.
          fatal ??= err as Error;
        }
      });
    } catch (err) {
      fatal ??= err as Error;
    }

    const results = await this.prisma.evalResult.findMany({
      where: { runId },
      select: { score: true, humanScore: true },
    });
    const summary = summarizeResults(results, run.passThreshold);
    await this.prisma.evalRun.update({
      where: { id: runId },
      data: {
        ...summary,
        status: fatal ? 'FAILED' : 'SUCCEEDED',
        error: fatal ? fatal.message || 'Error desconocido' : null,
        costUsd: new Prisma.Decimal(totals.cost.toFixed(8)),
        finishedAt: new Date(),
      },
    });
    if (fatal) this.logger.warn(`Corrida de evaluación ${runId} falló: ${fatal.message}`);
  }

  /** Agente + juez para un caso. Los errores no fatales quedan registrados en el resultado del caso. */
  private async evaluateCase(run: EvalRun, c: EvalCase, orgUnitId: string, totals: { cost: number }) {
    const base = { runId: run.id, caseId: c.id, input: c.input, expected: c.expected };

    let output: string;
    try {
      const r = await this.agents.runOnce(run.workspaceId, run.agentId, c.input, { source: 'EVAL' });
      totals.cost += Number(r.usage.costUsd) || 0;
      output = r.text;
    } catch (err) {
      if (isFatal(err)) throw err;
      await this.prisma.evalResult.create({
        data: {
          ...base,
          output: null,
          score: 0,
          passed: false,
          reasoning: `El agente falló: ${(err as Error).message}`,
        },
      });
      return;
    }

    let score: number | null = null;
    let reasoning: string;
    try {
      const judged = await this.llm.complete({
        workspaceId: run.workspaceId,
        orgUnitId,
        providerId: run.judgeProviderId,
        model: run.judgeModel,
        agentId: run.agentId,
        system: JUDGE_SYSTEM_PROMPT,
        userMessage: buildJudgeMessage({ input: c.input, expected: c.expected, criteria: c.criteria, output }),
        onCost: (usd) => (totals.cost += usd),
      });
      const verdict = parseJudgeResponse(judged.text);
      if (verdict) {
        score = verdict.score;
        reasoning = verdict.reasoning || 'El juez no incluyó un razonamiento.';
      } else {
        reasoning = `El juez no devolvió un JSON válido: ${judged.text.slice(0, 500)}`;
      }
    } catch (err) {
      if (isFatal(err)) {
        // El agente ya respondió: se conserva su salida antes de cortar la corrida.
        await this.prisma.evalResult.create({
          data: {
            ...base,
            output,
            score: null,
            needsReview: true,
            reasoning: `Juez no ejecutado: ${(err as Error).message}`,
          },
        });
        throw err;
      }
      reasoning = `El juez falló: ${(err as Error).message}`;
    }

    await this.prisma.evalResult.create({
      data: {
        ...base,
        output,
        score,
        passed: score !== null && score >= run.passThreshold,
        reasoning,
        needsReview: needsReview(score),
      },
    });
  }
}
