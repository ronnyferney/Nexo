import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Resuelve el agente dueño de un recurso del bucle de mejora (retroalimentación, caso, corrida, resultado,
 * sugerencia) para autorizar con `AgentAccessService` (ADR 0007). 404 si no existe en el workspace.
 */
@Injectable()
export class TrainingRefsService {
  constructor(private readonly prisma: PrismaService) {}

  async feedbackAgent(workspaceId: string, id: string): Promise<string> {
    const f = await this.prisma.messageFeedback.findFirst({ where: { id, workspaceId }, select: { agentId: true } });
    if (!f) throw new NotFoundException('Retroalimentación no encontrada');
    return f.agentId;
  }

  async caseAgent(workspaceId: string, id: string): Promise<string> {
    const c = await this.prisma.evalCase.findFirst({
      where: { id, agent: { workspaceId } },
      select: { agentId: true },
    });
    if (!c) throw new NotFoundException('Caso de evaluación no encontrado');
    return c.agentId;
  }

  async runAgent(workspaceId: string, id: string): Promise<string> {
    const r = await this.prisma.evalRun.findFirst({ where: { id, workspaceId }, select: { agentId: true } });
    if (!r) throw new NotFoundException('Corrida de evaluación no encontrada');
    return r.agentId;
  }

  async resultAgent(workspaceId: string, id: string): Promise<string> {
    const r = await this.prisma.evalResult.findFirst({
      where: { id, run: { workspaceId } },
      select: { run: { select: { agentId: true } } },
    });
    if (!r) throw new NotFoundException('Resultado de evaluación no encontrado');
    return r.run.agentId;
  }

  async suggestionAgent(workspaceId: string, id: string): Promise<string> {
    const s = await this.prisma.promptSuggestion.findFirst({
      where: { id, agent: { workspaceId } },
      select: { agentId: true },
    });
    if (!s) throw new NotFoundException('Sugerencia no encontrada');
    return s.agentId;
  }
}
