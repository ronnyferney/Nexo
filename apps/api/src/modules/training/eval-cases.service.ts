import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentsService } from '../agents/agents.service';
import { CreateEvalCaseDto, UpdateEvalCaseDto } from './dto/training.dto';

export const MAX_EVAL_CASES = 200;

const SELECT = {
  id: true,
  agentId: true,
  input: true,
  expected: true,
  criteria: true,
  tags: true,
  createdAt: true,
  updatedAt: true,
} as const;

const cleanTags = (tags?: string[]) =>
  tags === undefined ? undefined : [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
const orNull = (s?: string) => (s === undefined ? undefined : s.trim() || null);

/** Casos de evaluación por agente (ADR 0004, D2). */
@Injectable()
export class EvalCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
  ) {}

  async list(workspaceId: string, agentId: string) {
    await this.agents.get(workspaceId, agentId);
    return this.prisma.evalCase.findMany({ where: { agentId }, select: SELECT, orderBy: { createdAt: 'asc' } });
  }

  async create(workspaceId: string, agentId: string, dto: CreateEvalCaseDto) {
    await this.agents.get(workspaceId, agentId);
    const count = await this.prisma.evalCase.count({ where: { agentId } });
    if (count >= MAX_EVAL_CASES) {
      throw new ConflictException(`El agente ya tiene el máximo de ${MAX_EVAL_CASES} casos de evaluación.`);
    }
    return this.prisma.evalCase.create({
      data: {
        agentId,
        input: dto.input,
        expected: orNull(dto.expected) ?? null,
        criteria: orNull(dto.criteria) ?? null,
        tags: cleanTags(dto.tags) ?? [],
      },
      select: SELECT,
    });
  }

  async update(workspaceId: string, id: string, dto: UpdateEvalCaseDto) {
    await this.get(workspaceId, id);
    return this.prisma.evalCase.update({
      where: { id },
      data: {
        input: dto.input,
        expected: orNull(dto.expected),
        criteria: orNull(dto.criteria),
        tags: cleanTags(dto.tags),
      },
      select: SELECT,
    });
  }

  async remove(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    await this.prisma.evalCase.delete({ where: { id } });
  }

  private async get(workspaceId: string, id: string) {
    const c = await this.prisma.evalCase.findFirst({ where: { id, agent: { workspaceId } }, select: SELECT });
    if (!c) throw new NotFoundException('Caso de evaluación no encontrado');
    return c;
  }
}
