import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentsService } from '../agents/agents.service';
import { ConnectorsService } from '../connectors/connectors.service';
import {
  ConditionExecutor,
  DelayExecutor,
  OutputExecutor,
  TransformExecutor,
  TriggerExecutor,
} from './engine/executors/basic.executors';
import { AgentExecutor, ConnectorExecutor } from './engine/executors/integration.executors';
import { WorkflowEngine } from './engine/workflow-engine';
import type { StepLog, WorkflowDefinition } from './engine/workflow.types';

const json = (v: unknown) => (v ?? null) as Prisma.InputJsonValue;

/** Ejecuta una Execution persistida: corre el motor y guarda la bitácora en vivo. */
@Injectable()
export class WorkflowRunnerService {
  private readonly logger = new Logger(WorkflowRunnerService.name);
  private readonly engine: WorkflowEngine;

  constructor(
    private readonly prisma: PrismaService,
    connectors: ConnectorsService,
    agents: AgentsService,
  ) {
    this.engine = new WorkflowEngine([
      new TriggerExecutor(),
      new TransformExecutor(),
      new OutputExecutor(),
      new ConditionExecutor(),
      new DelayExecutor(),
      new ConnectorExecutor(connectors),
      new AgentExecutor(agents),
    ]);
  }

  async execute(executionId: string): Promise<void> {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
      include: { workflow: true },
    });
    if (!execution || execution.status !== 'QUEUED') return;

    await this.prisma.execution.update({
      where: { id: executionId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    const abort = new AbortController();

    const result = await this.engine.run(
      execution.workflow.definition as unknown as WorkflowDefinition,
      { workspaceId: execution.workspaceId, executionId, input: execution.input as Record<string, unknown>, nodes: {} },
      {
        signal: abort.signal,
        onStep: async (_: StepLog, all: StepLog[]) => {
          const row = await this.prisma.execution.update({
            where: { id: executionId },
            data: { steps: json(all) },
            select: { status: true },
          });
          if (row.status === 'CANCELLED') abort.abort();
        },
      },
    );

    const current = await this.prisma.execution.findUnique({ where: { id: executionId }, select: { status: true } });
    await this.prisma.execution.update({
      where: { id: executionId },
      data: {
        status: current?.status === 'CANCELLED' ? 'CANCELLED' : result.status,
        output: json(result.output),
        error: result.error,
        steps: json(result.steps),
        finishedAt: new Date(),
      },
    });
    if (result.status === 'FAILED') this.logger.warn(`Ejecución ${executionId} falló: ${result.error}`);
  }
}
