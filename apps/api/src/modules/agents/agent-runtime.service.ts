import { Injectable, Logger } from '@nestjs/common';
import type { Agent, AgentTool, Connector, ConnectorOperation } from '@prisma/client';
import { ConnectorsService } from '../connectors/connectors.service';
import type { UsageSource } from '@prisma/client';
import { BudgetsService } from '../governance/budgets.service';
import { OrgService } from '../governance/org.service';
import { LlmGatewayService } from '../llm/llm-gateway.service';
import type { AgentEvent, Effort, LlmRunResult, ToolSpec } from '../llm/llm-provider';
import { costUsd } from '../llm/pricing';

const MAX_TOOL_OUTPUT = 50_000;

export type AgentWithTools = Agent & {
  tools: (AgentTool & { operation: ConnectorOperation & { connector: Connector } })[];
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

/** Nombre de tool estable y válido para el LLM: <conector>__<operación>. */
export function toolName(connectorName: string, opKey: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  return `${slug(connectorName).slice(0, 24)}__${slug(opKey)}`.slice(0, 64);
}

/**
 * Orquesta la ejecución de un agente: aplica el gobierno de costos (centro de costo, modelos permitidos,
 * presupuestos y degradación), arma las tools desde los conectores, delega el bucle al proveedor y mide cada turno.
 */
@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name);

  constructor(
    private readonly gateway: LlmGatewayService,
    private readonly connectors: ConnectorsService,
    private readonly org: OrgService,
    private readonly budgets: BudgetsService,
  ) {}

  async run(agent: AgentWithTools, opts: AgentRunOptions): Promise<AgentRunResult> {
    const ws = agent.workspaceId;
    const orgUnitId = await this.org.resolveCostCenter(ws, opts.context.userId, agent.costCenterId);
    const plan = await this.budgets.plan(ws, orgUnitId, agent.provider, agent.model);
    if (plan.notice) opts.onEvent?.({ type: 'notice', message: plan.notice });
    const resolved = await this.gateway.resolve(ws, plan.providerId, plan.model);

    let history = opts.history ?? [];
    if (history.length && opts.historyProviderId && opts.historyProviderId !== resolved.providerId) {
      opts.onEvent?.({
        type: 'notice',
        message: 'El proveedor cambió; se inicia un historial nuevo para esta respuesta.',
      });
      history = [];
    }

    const bindings = new Map<string, AgentWithTools['tools'][number]>();
    const tools: ToolSpec[] = [];
    for (const binding of agent.tools) {
      const op = binding.operation;
      const name = toolName(op.connector.name, op.key);
      if (bindings.has(name)) continue;
      bindings.set(name, binding);
      tools.push({
        name,
        description: [op.description ?? op.name, binding.requiresApproval ? '(Requiere aprobación humana)' : '']
          .filter(Boolean)
          .join(' '),
        inputSchema: op.inputSchema as Record<string, unknown>,
      });
    }

    const approved = new Set(opts.approvedTools ?? []);
    let totalCost = 0;
    const result = await resolved.client.run({
      model: resolved.model,
      system: agent.systemPrompt,
      effort: agent.effort as Effort,
      history,
      userMessage: opts.message,
      tools,
      maxTurns: agent.maxTurns,
      onEvent: opts.onEvent,
      signal: opts.signal,
      beforeTurn: () => this.budgets.assertCanSpend(ws, orgUnitId),
      onUsage: async (usage) => {
        const cost = costUsd(usage, resolved.pricing);
        totalCost += cost;
        await this.budgets.record(
          { workspaceId: ws, orgUnitId, agentId: agent.id, ...opts.context },
          plan.chainIds,
          resolved.providerId,
          resolved.model,
          usage,
          cost,
        );
      },
      executeTool: async (call) => {
        const binding = bindings.get(call.name);
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
          return {
            content:
              serialized.length > MAX_TOOL_OUTPUT ? `${serialized.slice(0, MAX_TOOL_OUTPUT)}…[truncado]` : serialized,
            isError: !result.ok,
          };
        } catch (err) {
          this.logger.warn(`Tool ${call.name} falló: ${(err as Error).message}`);
          return { content: `Error: ${(err as Error).message}`, isError: true };
        }
      },
    });
    return { ...result, providerId: resolved.providerId, model: resolved.model, costUsd: totalCost };
  }
}
