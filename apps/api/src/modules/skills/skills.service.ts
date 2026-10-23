import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Skill } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { CreateSkillDto, UpdateSkillDto } from './dto/skill.dto';

const MAX_SLUG = 48;

/** Identificador estable a partir del nombre: minúsculas, sin acentos, separado por guiones. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
  return slug || 'habilidad';
}

/**
 * Skills reutilizables (ADR 0003, D3): nombre, slug único por workspace, descripción (cuándo usarla), instrucciones
 * completas (divulgación progresiva vía `load_skill`) y operaciones de conector que se suman a las tools del agente.
 */
@Injectable()
export class SkillsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string) {
    const skills = await this.prisma.skill.findMany({
      where: { workspaceId },
      include: { _count: { select: { agents: true } } },
      orderBy: { name: 'asc' },
    });
    return skills.map((s) => this.view(s, s._count.agents));
  }

  async get(workspaceId: string, id: string) {
    const skill = await this.prisma.skill.findFirst({
      where: { id, workspaceId },
      include: { _count: { select: { agents: true } } },
    });
    if (!skill) throw new NotFoundException('Habilidad no encontrada');
    return this.view(skill, skill._count.agents);
  }

  async create(workspaceId: string, dto: CreateSkillDto) {
    const name = dto.name.trim();
    const operationIds = await this.validOperations(workspaceId, dto.operationIds ?? []);
    const skill = await this.prisma.skill.create({
      data: {
        workspaceId,
        name,
        slug: await this.uniqueSlug(workspaceId, name),
        description: dto.description.trim(),
        instructions: dto.instructions,
        operationIds,
      },
    });
    return this.get(workspaceId, skill.id);
  }

  async update(workspaceId: string, id: string, dto: UpdateSkillDto) {
    const current = await this.get(workspaceId, id);
    const name = dto.name?.trim();
    await this.prisma.skill.update({
      where: { id },
      data: {
        ...(name !== undefined && name !== current.name
          ? { name, slug: await this.uniqueSlug(workspaceId, name, id) }
          : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
        ...(dto.instructions !== undefined ? { instructions: dto.instructions } : {}),
        ...(dto.operationIds !== undefined
          ? { operationIds: await this.validOperations(workspaceId, dto.operationIds) }
          : {}),
      },
    });
    return this.get(workspaceId, id);
  }

  async remove(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    await this.prisma.skill.delete({ where: { id } });
  }

  /** Todas las operaciones deben pertenecer a conectores del workspace. */
  private async validOperations(workspaceId: string, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const found = await this.prisma.connectorOperation.findMany({
      where: { id: { in: unique }, connector: { workspaceId } },
      select: { id: true },
    });
    const valid = new Set(found.map((f) => f.id));
    const invalid = unique.filter((id) => !valid.has(id));
    if (invalid.length)
      throw new BadRequestException(`Operaciones no encontradas en el workspace: ${invalid.join(', ')}`);
    return unique;
  }

  private async uniqueSlug(workspaceId: string, name: string, exceptId?: string): Promise<string> {
    const base = slugify(name);
    const taken = await this.prisma.skill.findMany({
      where: { workspaceId, slug: { startsWith: base }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { slug: true },
    });
    const used = new Set(taken.map((t) => t.slug));
    if (!used.has(base)) return base;
    for (let i = 2; ; i++) {
      const suffix = `-${i}`;
      const candidate = `${base.slice(0, MAX_SLUG - suffix.length)}${suffix}`;
      if (!used.has(candidate)) return candidate;
    }
  }

  private view(s: Skill, agentCount: number) {
    return {
      id: s.id,
      name: s.name,
      slug: s.slug,
      description: s.description,
      instructions: s.instructions,
      operationIds: s.operationIds,
      agentCount,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }
}
