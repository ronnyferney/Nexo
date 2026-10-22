import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentsService } from '../agents/agents.service';
import { WorkflowsService } from '../workflows/workflows.service';

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
const text = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  isError,
});

/**
 * Construye un servidor MCP por workspace: cada agente y cada flujo activo
 * se publica como una tool invocable por clientes MCP (Claude, IDEs, otros agentes).
 */
@Injectable()
export class McpServerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
    private readonly workflows: WorkflowsService,
  ) {}

  async build(workspaceId: string): Promise<McpServer> {
    const server = new McpServer({ name: 'nexo', version: '1.0.0' });
    const [agents, workflows] = await Promise.all([
      this.prisma.agent.findMany({ where: { workspaceId }, select: { id: true, name: true, description: true } }),
      this.prisma.workflow.findMany({
        where: { workspaceId, active: true },
        select: { id: true, name: true, description: true },
      }),
    ]);
    const used = new Set<string>();
    const unique = (base: string) => {
      let name = base;
      for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
      used.add(name);
      return name;
    };

    for (const agent of agents) {
      server.registerTool(
        unique(`agent_${slug(agent.name)}`),
        {
          title: agent.name,
          description: agent.description ?? `Agente de IA "${agent.name}" de Nexo`,
          inputSchema: { message: z.string().describe('Instrucción o pregunta para el agente') },
        },
        async ({ message }) => {
          try {
            const r = await this.agents.runOnce(workspaceId, agent.id, message);
            return text(r.text);
          } catch (err) {
            return text((err as Error).message, true);
          }
        },
      );
    }

    for (const wf of workflows) {
      server.registerTool(
        unique(`workflow_${slug(wf.name)}`),
        {
          title: wf.name,
          description: wf.description ?? `Flujo de automatización "${wf.name}" (espera hasta 60 s el resultado)`,
          inputSchema: { input: z.record(z.unknown()).optional().describe('Datos de entrada del flujo') },
        },
        async ({ input }) => {
          const ex = await this.workflows.run(workspaceId, wf.id, input ?? {}, 'MCP', true);
          if (ex.status === 'SUCCEEDED') return text(ex.output);
          return text({ executionId: ex.id, status: ex.status, error: ex.error }, ex.status === 'FAILED');
        },
      );
    }
    return server;
  }
}
