import { Injectable, Logger } from '@nestjs/common';
import type { Agent, AgentTool, Connector, ConnectorOperation } from '@prisma/client';
import { ConnectorsService } from '../connectors/connectors.service';
import type { AgentEvent, Effort, LlmRunResult, ToolSpec } from '../llm/llm-provider';
import { LlmRegistry } from '../llm/llm.registry';

const MAX_TOOL_OUTPUT = 50_000;

export type AgentWithTools = Agent & {
  tools: (AgentTool & { operation: ConnectorOperation & { connector: Connector } })[];
};

export interface AgentRunOptions {
  history?: unknown[];
  message: string;
  approvedTools?: string[];
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
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

/** Orquesta la ejecución de un agente: arma las tools desde los conectores y delega el bucle al proveedor. */
@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name);

  constructor(
    private readonly llm: LlmRegistry,
    private readonly connectors: ConnectorsService,
  ) {}

  async run(agent: AgentWithTools, opts: AgentRunOptions): Promise<LlmRunResult> {
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
    return this.llm.get(agent.provider).run({
      model: agent.model,
      system: agent.systemPrompt,
      effort: agent.effort as Effort,
      history: opts.history ?? [],
      userMessage: opts.message,
      tools,
      maxTurns: agent.maxTurns,
      onEvent: opts.onEvent,
      signal: opts.signal,
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
  }
}
