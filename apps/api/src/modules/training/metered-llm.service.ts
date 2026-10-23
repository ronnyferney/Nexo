import { Injectable } from '@nestjs/common';
import { BudgetsService } from '../governance/budgets.service';
import { LlmGatewayService } from '../llm/llm-gateway.service';
import { costUsd } from '../llm/pricing';

export interface MeteredCall {
  workspaceId: string;
  /** Centro de costo al que se imputa el consumo (el del agente evaluado). */
  orgUnitId: string;
  providerId: string;
  model: string;
  system: string;
  userMessage: string;
  agentId: string;
  /** Solo trazabilidad del registro de consumo; no cambia el centro de costo. */
  userId?: string;
  /** Se invoca con el costo de cada turno en cuanto se registra (también si luego falla). */
  onCost?: (usd: number) => void;
}

/**
 * Llamada única (sin herramientas ni historial) a un modelo del catálogo, con gobierno de costos ADR 0002:
 * planificación (modelos permitidos, presupuesto, degradación), control antes del turno y registro `source: EVAL`.
 * La usan el juez de las evaluaciones y el optimizador de sugerencias.
 */
@Injectable()
export class MeteredLlmService {
  constructor(
    private readonly gateway: LlmGatewayService,
    private readonly budgets: BudgetsService,
  ) {}

  async complete(call: MeteredCall): Promise<{ text: string; costUsd: number; providerId: string; model: string }> {
    const ws = call.workspaceId;
    const plan = await this.budgets.plan(ws, call.orgUnitId, call.providerId, call.model);
    const resolved = await this.gateway.resolve(ws, plan.providerId, plan.model);
    let total = 0;
    const result = await resolved.client.run({
      model: resolved.model,
      system: call.system,
      userMessage: call.userMessage,
      effort: 'low',
      history: [],
      tools: [],
      maxTurns: 1,
      beforeTurn: () => this.budgets.assertCanSpend(ws, call.orgUnitId),
      onUsage: async (usage) => {
        const cost = costUsd(usage, resolved.pricing);
        total += cost;
        call.onCost?.(cost);
        await this.budgets.record(
          { workspaceId: ws, orgUnitId: call.orgUnitId, source: 'EVAL', agentId: call.agentId, userId: call.userId },
          plan.chainIds,
          resolved.providerId,
          resolved.model,
          usage,
          cost,
        );
      },
      executeTool: async () => ({ content: 'No hay herramientas disponibles.', isError: true }),
    });
    return { text: result.text, costUsd: total, providerId: resolved.providerId, model: resolved.model };
  }
}
