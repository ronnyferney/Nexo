import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
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
import { LoopExecutor, SubworkflowExecutor } from './engine/executors/flow.executors';
import { AgentExecutor, ConnectorExecutor } from './engine/executors/integration.executors';
import { WorkflowEngine, type SingleNodeResult } from './engine/workflow-engine';
import type { ExecutionContext, StepLog, SubworkflowRunner, WorkflowDefinition } from './engine/workflow.types';
import { WorkflowsService } from './workflows.service';

const json = (v: unknown) => (v ?? null) as Prisma.InputJsonValue;

/**
 * Marca en la entrada de las ejecuciones disparadas como "flujo de error". Una ejecución con esta marca nunca
 * dispara a su vez otro flujo de error (evita cadenas y bucles A→B→A).
 */
export const ERROR_TRIGGER_FLAG = '_errorTrigger';

/** Ejecuta una Execution persistida: corre el motor y guarda la bitácora en vivo. */
@Injectable()
export class WorkflowRunnerService {
  private readonly logger = new Logger(WorkflowRunnerService.name);
  private readonly engine: WorkflowEngine;

  constructor(
    private readonly prisma: PrismaService,
    connectors: ConnectorsService,
    agents: AgentsService,
    private readonly workflows: WorkflowsService,
  ) {
    const runSub: SubworkflowRunner = (workflowId, input, depth, parent) =>
      this.runSubworkflow(workflowId, input, depth, parent);
    this.engine = new WorkflowEngine([
      new TriggerExecutor(),
      new TransformExecutor(),
      new OutputExecutor(),
      new ConditionExecutor(),
      new DelayExecutor(),
      new ConnectorExecutor(connectors),
      new AgentExecutor(agents),
      new SubworkflowExecutor(runSub),
      new LoopExecutor(runSub),
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
      {
        workspaceId: execution.workspaceId,
        executionId,
        workflowId: execution.workflowId,
        input: execution.input as Record<string, unknown>,
        nodes: {},
        depth: 0,
      },
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
    const cancelled = current?.status === 'CANCELLED';
    await this.prisma.execution.update({
      where: { id: executionId },
      data: {
        status: cancelled ? 'CANCELLED' : result.status,
        output: json(result.output),
        error: result.error,
        steps: json(result.steps),
        finishedAt: new Date(),
      },
    });
    if (result.status === 'FAILED' && !cancelled) {
      this.logger.warn(`Ejecución ${executionId} falló: ${result.error}`);
      await this.triggerErrorWorkflow(execution, result.error ?? 'Error desconocido', result.steps);
    }
  }

  /** Prueba un nodo del flujo guardado con entrada y salidas fijadas (pinned) de nodos previos. */
  async testNode(
    workspaceId: string,
    workflowId: string,
    nodeId: string,
    input: Record<string, unknown>,
    pinned: Record<string, unknown>,
  ): Promise<SingleNodeResult> {
    const wf = await this.workflows.get(workspaceId, workflowId);
    const def = wf.definition as unknown as WorkflowDefinition;
    const node = def.nodes?.find((n) => n.id === nodeId);
    if (!node) throw new NotFoundException('Nodo no encontrado en el flujo guardado');
    const nodes: ExecutionContext['nodes'] = {};
    for (const [id, output] of Object.entries(pinned)) nodes[id] = { output };
    return this.engine.runSingle(node, {
      workspaceId,
      executionId: `node-test:${randomUUID()}`,
      workflowId,
      input,
      nodes,
      depth: 0,
    });
  }

  /** Sub-flujo en línea (sin cola): misma ejecución raíz para medición de costos y cancelación. */
  private async runSubworkflow(
    workflowId: string,
    input: Record<string, unknown>,
    depth: number,
    parent: ExecutionContext,
  ): Promise<unknown> {
    const wf = await this.prisma.workflow.findFirst({
      where: { id: workflowId, workspaceId: parent.workspaceId },
      select: { id: true, definition: true },
    });
    if (!wf) throw new Error(`Sub-flujo no encontrado: ${workflowId}`);
    const result = await this.engine.run(
      wf.definition as unknown as WorkflowDefinition,
      {
        workspaceId: parent.workspaceId,
        executionId: parent.executionId,
        workflowId: wf.id,
        input,
        nodes: {},
        depth,
        signal: parent.signal,
      },
      { signal: parent.signal },
    );
    if (result.status === 'FAILED') throw new Error(result.error ?? 'El sub-flujo falló');
    return result.output;
  }

  private async triggerErrorWorkflow(
    execution: {
      id: string;
      workspaceId: string;
      input: unknown;
      workflow: { id: string; name: string; errorWorkflowId: string | null };
    },
    error: string,
    steps: StepLog[],
  ): Promise<void> {
    const errorWorkflowId = execution.workflow.errorWorkflowId;
    if (!errorWorkflowId || errorWorkflowId === execution.workflow.id) return;
    const input = (execution.input ?? {}) as Record<string, unknown>;
    if (input[ERROR_TRIGGER_FLAG] === true) return;
    const failed = steps.find((s) => s.status === 'failed');
    try {
      await this.workflows.run(
        execution.workspaceId,
        errorWorkflowId,
        {
          workflow: { id: execution.workflow.id, name: execution.workflow.name },
          execution: { id: execution.id },
          error,
          failedNode: failed ? { id: failed.nodeId, name: failed.nodeName, type: failed.type } : null,
          [ERROR_TRIGGER_FLAG]: true,
        },
        'MANUAL',
      );
    } catch (err) {
      this.logger.warn(`No se pudo disparar el flujo de error ${errorWorkflowId}: ${(err as Error).message}`);
    }
  }
}
