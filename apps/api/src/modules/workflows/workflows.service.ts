import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, type TriggerType } from '@prisma/client';
import { Queue, QueueEvents } from 'bullmq';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentAccessService } from '../agent-access/agent-access.service';
import { checkInput, inputErrorMessage, inputWarnings } from './engine/workflow-input';
import type { WorkflowDefinition } from './engine/workflow.types';
import { validateDefinition } from './engine/workflow.validator';
import { CreateWorkflowDto, UpdateWorkflowDto } from './dto/workflow.dto';
import { JOB_RUN, JOB_SCHEDULED, schedulerId, WORKFLOW_QUEUE, type RunJobData } from './queue/workflow-queue.constants';

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Serialización con claves ordenadas: JSONB de Postgres no conserva el orden de las claves. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}
const MAX_WAIT_MS = 60_000;

/** Agentes referenciados por nodos `agent` (ids literales; las plantillas se resuelven en ejecución). */
export function agentRefs(def: WorkflowDefinition | null | undefined): { nodeId: string; agentId: string }[] {
  const nodes = Array.isArray(def?.nodes) ? def.nodes : [];
  return nodes
    .filter((n) => n?.type === 'agent')
    .map((n) => ({ nodeId: n.id, agentId: typeof n.config?.agentId === 'string' ? n.config.agentId.trim() : '' }))
    .filter((r) => r.agentId && !r.agentId.includes('{{'));
}

@Injectable()
export class WorkflowsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowsService.name);
  private events?: QueueEvents;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AgentAccessService,
    @InjectQueue(WORKFLOW_QUEUE) private readonly queue: Queue,
  ) {}

  onModuleInit(): void {
    this.events = new QueueEvents(WORKFLOW_QUEUE, { connection: this.queue.opts.connection });
  }

  async onModuleDestroy(): Promise<void> {
    await this.events?.close();
  }

  list(workspaceId: string) {
    return this.prisma.workflow.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        description: true,
        active: true,
        schedule: true,
        version: true,
        errorWorkflowId: true,
        updatedAt: true,
        _count: { select: { executions: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(workspaceId: string, id: string) {
    const wf = await this.prisma.workflow.findFirst({ where: { id, workspaceId } });
    if (!wf) throw new NotFoundException('Flujo no encontrado');
    return wf;
  }

  async create(auth: AuthContext, dto: CreateWorkflowDto) {
    const { workspaceId } = auth;
    const definition = dto.definition ?? {
      nodes: [{ id: 'trigger', type: 'trigger', name: 'Inicio', position: { x: 80, y: 160 }, config: {} }],
      edges: [],
    };
    this.assertValid(definition);
    await this.assertAgentRefs(auth, definition);
    return this.prisma.workflow.create({ data: { ...dto, workspaceId, definition: json(definition) } });
  }

  async update(auth: AuthContext, id: string, dto: UpdateWorkflowDto) {
    const { workspaceId } = auth;
    const current = await this.get(workspaceId, id);
    if (dto.definition) {
      this.assertValid(dto.definition);
      await this.assertAgentRefs(auth, dto.definition, current.definition as unknown as WorkflowDefinition);
    }
    if (dto.errorWorkflowId) await this.assertErrorWorkflow(workspaceId, id, dto.errorWorkflowId);
    const definitionChanged =
      dto.definition !== undefined && canonical(dto.definition) !== canonical(current.definition);
    const { definition, ...rest } = dto;
    let wf;
    try {
      wf = await this.prisma.$transaction(async (tx) => {
        if (definitionChanged) {
          // Historial inmutable: se guarda la definición ANTERIOR con su número de versión.
          await tx.workflowVersion.create({
            data: { workflowId: id, version: current.version, definition: json(current.definition) },
          });
        }
        return tx.workflow.update({
          where: definitionChanged ? { id, version: current.version } : { id },
          data: {
            ...rest,
            definition: definitionChanged ? json(definition) : undefined,
            version: definitionChanged ? { increment: 1 } : undefined,
          },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2025'].includes(err.code)) {
        throw new ConflictException('El flujo fue modificado por otra petición; recárguelo e intente de nuevo');
      }
      throw err;
    }
    if (current.active && dto.schedule !== undefined) await this.syncSchedule(wf.id, wf.active, wf.schedule);
    return wf;
  }

  /** Historial: la versión actual (current: true) primero y luego las anteriores, de la más reciente a la más antigua. */
  async listVersions(workspaceId: string, id: string) {
    const wf = await this.get(workspaceId, id);
    const history = await this.prisma.workflowVersion.findMany({
      where: { workflowId: id },
      orderBy: { version: 'desc' },
      select: { version: true, createdAt: true, definition: true },
    });
    const nodeCount = (d: unknown) => (d as WorkflowDefinition)?.nodes?.length ?? 0;
    return [
      { version: wf.version, createdAt: wf.updatedAt, nodeCount: nodeCount(wf.definition), current: true },
      ...history.map((v) => ({
        version: v.version,
        createdAt: v.createdAt,
        nodeCount: nodeCount(v.definition),
        current: false,
      })),
    ];
  }

  async getVersion(workspaceId: string, id: string, version: number) {
    const wf = await this.get(workspaceId, id);
    if (version === wf.version) return { version, createdAt: wf.updatedAt, current: true, definition: wf.definition };
    const v = await this.prisma.workflowVersion.findUnique({
      where: { workflowId_version: { workflowId: id, version } },
    });
    if (!v) throw new NotFoundException('Versión no encontrada');
    return { version: v.version, createdAt: v.createdAt, current: false, definition: v.definition };
  }

  /** Restaurar no reescribe historia: la definición elegida se guarda como una versión nueva. */
  async restoreVersion(auth: AuthContext, id: string, version: number) {
    const wf = await this.get(auth.workspaceId, id);
    if (version === wf.version) throw new BadRequestException('Esa versión ya es la actual');
    const v = await this.prisma.workflowVersion.findUnique({
      where: { workflowId_version: { workflowId: id, version } },
    });
    if (!v) throw new NotFoundException('Versión no encontrada');
    return this.update(auth, id, { definition: v.definition as unknown as WorkflowDefinition });
  }

  async remove(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    await this.syncSchedule(id, false, null);
    await this.prisma.$transaction([
      this.prisma.workflow.updateMany({ where: { workspaceId, errorWorkflowId: id }, data: { errorWorkflowId: null } }),
      this.prisma.workflow.delete({ where: { id } }),
    ]);
  }

  async setActive(workspaceId: string, id: string, active: boolean) {
    const wf = await this.get(workspaceId, id);
    if (active) this.assertValid(wf.definition as unknown as WorkflowDefinition);
    const updated = await this.prisma.workflow.update({ where: { id }, data: { active } });
    await this.syncSchedule(id, active, updated.schedule);
    return updated;
  }

  async regenerateWebhook(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    const { webhookToken } = await this.prisma.workflow.update({
      where: { id },
      data: { webhookToken: `wh_${crypto.randomUUID().replace(/-/g, '')}` },
      select: { webhookToken: true },
    });
    return { webhookToken };
  }

  /**
   * Encola una ejecución. Con `wait` espera el resultado (respuesta síncrona para webhooks / MCP).
   * Antes de encolar comprueba la entrada (P2): un campo requerido del esquema del disparador ausente o con otro tipo
   * responde 400 sin crear la ejecución; los campos que usan las plantillas y faltan vuelven en `inputWarnings`.
   */
  async run(
    workspaceId: string,
    workflowId: string,
    input: Record<string, unknown>,
    trigger: TriggerType,
    wait = false,
  ) {
    const wf = await this.get(workspaceId, workflowId);
    const check = checkInput(wf.definition as unknown as WorkflowDefinition, input);
    const inputError = inputErrorMessage(check);
    if (inputError) throw new BadRequestException(inputError);
    const warnings = inputWarnings(check);
    const execution = await this.prisma.execution.create({
      data: { workflowId, workspaceId, trigger, input: json(input) },
    });
    const job = await this.queue.add(JOB_RUN, { executionId: execution.id } satisfies RunJobData, {
      jobId: execution.id,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
    if (!wait || !this.events) return { ...execution, inputWarnings: warnings };
    try {
      await job.waitUntilFinished(this.events, MAX_WAIT_MS);
    } catch (err) {
      this.logger.debug(`Espera de ${execution.id} terminó: ${(err as Error).message}`);
    }
    const finished = await this.prisma.execution.findUniqueOrThrow({ where: { id: execution.id } });
    return { ...finished, inputWarnings: warnings };
  }

  async runByWebhook(token: string, input: Record<string, unknown>, wait: boolean) {
    const wf = await this.prisma.workflow.findUnique({ where: { webhookToken: token } });
    if (!wf || !wf.active) throw new NotFoundException('Webhook no encontrado o flujo inactivo');
    const execution = await this.run(wf.workspaceId, wf.id, input, 'WEBHOOK', wait);
    return {
      executionId: execution.id,
      status: execution.status,
      output: execution.output,
      error: execution.error,
      inputWarnings: execution.inputWarnings,
    };
  }

  async cancel(workspaceId: string, executionId: string) {
    const ex = await this.prisma.execution.findFirst({ where: { id: executionId, workspaceId } });
    if (!ex) throw new NotFoundException('Ejecución no encontrada');
    if (!['QUEUED', 'RUNNING'].includes(ex.status)) throw new BadRequestException('La ejecución ya terminó');
    if (ex.status === 'QUEUED') await this.queue.remove(executionId).catch(() => undefined);
    return this.prisma.execution.update({
      where: { id: executionId },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
  }

  async retry(workspaceId: string, executionId: string) {
    const ex = await this.prisma.execution.findFirst({ where: { id: executionId, workspaceId } });
    if (!ex) throw new NotFoundException('Ejecución no encontrada');
    return this.run(workspaceId, ex.workflowId, ex.input as Record<string, unknown>, ex.trigger);
  }

  private async assertErrorWorkflow(workspaceId: string, id: string, errorWorkflowId: string): Promise<void> {
    if (errorWorkflowId === id) throw new BadRequestException('Un flujo no puede ser su propio flujo de error');
    const target = await this.prisma.workflow.findFirst({
      where: { id: errorWorkflowId, workspaceId },
      select: { id: true },
    });
    if (!target) throw new BadRequestException('El flujo de error no existe en este workspace');
  }

  /**
   * ADR 0007 D5: un nodo `agent` solo puede referenciar agentes que quien guarda el flujo puede USAR. Se validan solo
   * las referencias NUEVAS respecto de la definición guardada: un flujo existente no se rompe porque lo edite alguien
   * sin acceso a un agente que ya estaba referenciado. El mensaje no distingue "no existe" de "sin permiso".
   */
  private async assertAgentRefs(auth: AuthContext, def: WorkflowDefinition, previous?: WorkflowDefinition) {
    const before = new Set(agentRefs(previous).map((r) => r.agentId));
    const errors: string[] = [];
    for (const ref of agentRefs(def).filter((r) => !before.has(r.agentId))) {
      try {
        await this.access.assert(auth, ref.agentId, 'USE');
      } catch (err) {
        if (!(err instanceof NotFoundException || err instanceof ForbiddenException)) throw err;
        errors.push(`El nodo "${ref.nodeId}" referencia un agente que no existe o que usted no puede usar`);
      }
    }
    if (errors.length) throw new BadRequestException(errors);
  }

  private assertValid(def: WorkflowDefinition): void {
    const errors = validateDefinition(def);
    if (errors.length) throw new BadRequestException(errors);
  }

  private async syncSchedule(workflowId: string, active: boolean, schedule: string | null): Promise<void> {
    const id = schedulerId(workflowId);
    if (active && schedule) {
      await this.queue.upsertJobScheduler(id, { pattern: schedule }, { name: JOB_SCHEDULED, data: { workflowId } });
    } else {
      await this.queue.removeJobScheduler(id);
    }
  }
}
