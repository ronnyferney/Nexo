import { render } from '../../../../common/template/template.engine';
import type { AgentsService } from '../../../agents/agents.service';
import type { ConnectorsService } from '../../../connectors/connectors.service';
import type { ExecutionContext, NodeExecutor, NodeResult, WorkflowNode } from '../workflow.types';
import { templateContext } from './basic.executors';

/** Invoca una operación de conector (REST / SOAP / GraphQL / MCP). */
export class ConnectorExecutor implements NodeExecutor {
  readonly type = 'connector' as const;
  constructor(private readonly connectors: ConnectorsService) {}

  async execute(node: WorkflowNode, ctx: ExecutionContext): Promise<NodeResult> {
    const operationId = String(node.config.operationId ?? '');
    if (!operationId) throw new Error('Seleccione una operación de conector');
    const input = render<Record<string, unknown>>(node.config.input ?? {}, templateContext(ctx));
    const result = await this.connectors.invokeById(ctx.workspaceId, operationId, input);
    if (!result.ok && node.config.failOnHttpError !== false) {
      throw new Error(
        `La operación respondió con error (HTTP ${result.status ?? '?'}): ${JSON.stringify(result.data).slice(0, 500)}`,
      );
    }
    return { output: result, resolvedInput: input };
  }
}

/** Delega una tarea a un agente de IA; su respuesta queda en `output.text`. */
export class AgentExecutor implements NodeExecutor {
  readonly type = 'agent' as const;
  constructor(private readonly agents: AgentsService) {}

  async execute(node: WorkflowNode, ctx: ExecutionContext): Promise<NodeResult> {
    const agentId = String(node.config.agentId ?? '');
    if (!agentId) throw new Error('Seleccione un agente');
    const message = render<unknown>(node.config.message ?? '{{ input }}', templateContext(ctx));
    const text = typeof message === 'string' ? message : JSON.stringify(message);
    const result = await this.agents.runOnce(ctx.workspaceId, agentId, text);
    let parsed: unknown;
    if (node.config.parseJson) {
      const match = /```(?:json)?\s*([\s\S]*?)```/.exec(result.text);
      try {
        parsed = JSON.parse(match ? match[1] : result.text);
      } catch {
        throw new Error('La respuesta del agente no es JSON válido');
      }
    }
    return { output: { ...result, json: parsed }, resolvedInput: { message: text } };
  }
}
