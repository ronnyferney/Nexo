import { BadRequestException, Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentsService } from '../agents/agents.service';
import { declaredInputFields } from '../workflows/engine/workflow-input';
import type { WorkflowDefinition } from '../workflows/engine/workflow.types';
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

/** Descripción del argumento `input` con los campos declarados en el disparador del flujo (si los hay). */
function inputDescription(definition: unknown): string {
  const fields = declaredInputFields(definition as WorkflowDefinition);
  if (!fields?.length) return 'Datos de entrada del flujo';
  const list = fields
    .map(
      (f) =>
        `${f.name} (${f.type ?? 'cualquiera'}${f.required ? ', requerido' : ''})${f.description ? `: ${f.description}` : ''}`,
    )
    .join('; ');
  return `Datos de entrada del flujo. Campos: ${list}`;
}

/**
 * Construye un servidor MCP por workspace: cada agente de empresa lanzado (WORKSPACE + LAUNCHED) y cada flujo activo
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
      // Solo agentes de empresa lanzados (ADR 0006 D4 + ADR 0007 D5): ni borradores ni agentes personales o de equipo.
      this.prisma.agent.findMany({
        where: { workspaceId, visibility: 'WORKSPACE', launchStatus: 'LAUNCHED' },
        select: { id: true, name: true, description: true },
      }),
      this.prisma.workflow.findMany({
        where: { workspaceId, active: true },
        select: { id: true, name: true, description: true, definition: true },
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
            const r = await this.agents.runOnce(workspaceId, agent.id, message, { source: 'MCP' });
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
          inputSchema: {
            input: z.record(z.string(), z.unknown()).optional().describe(inputDescription(wf.definition)),
          },
        },
        async ({ input }) => {
          let ex;
          try {
            ex = await this.workflows.run(workspaceId, wf.id, input ?? {}, 'MCP', true);
          } catch (err) {
            // Entrada incompleta (400): el cliente MCP recibe qué datos faltan en vez de un error genérico.
            if (err instanceof BadRequestException) return text(err.message, true);
            throw err;
          }
          if (ex.status === 'SUCCEEDED') return text(ex.output);
          return text({ executionId: ex.id, status: ex.status, error: ex.error }, ex.status === 'FAILED');
        },
      );
    }
    return server;
  }
}
