import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import { AgentsService } from '../agents/agents.service';
import type { CreateAgentDto } from '../agents/dto/agent.dto';
import type { InstallAgentTemplateDto, PublishAgentTemplateDto } from './dto/agent-template.dto';

/**
 * Perfil/prompt saneado que se empaqueta en el payload de la plantilla. SOLO configuración reutilizable: nunca
 * secretos, credenciales ni responsable.
 */
interface TemplatePerfil {
  provider: string;
  model: string;
  systemPrompt: string;
  effort: string;
  maxTurns: number;
  profile: unknown;
  fallbackModels: string[];
  routing: unknown;
  targetScore: number;
}

/** Operación requerida POR CAPACIDAD (tipo de conector + clave de operación), nunca por conector concreto. */
interface TemplateOperacion {
  connectorType: string;
  operationKey: string;
  operationName: string;
}

/** Referencia de skill PORTABLE (por slug), no por id concreto del workspace de origen. */
interface TemplateSkill {
  slug: string;
  name: string;
}

/** Payload declarativo y saneado de una versión de plantilla (lo que se persiste y se reinstala). */
interface TemplatePayload {
  cargo: { cargoId: string | null; nivel: string | null };
  perfil: TemplatePerfil;
  skills: TemplateSkill[];
  operaciones: TemplateOperacion[];
  parametrosEjecucionRecomendados: Record<string, unknown>;
}

/**
 * Agent Hub · plantillas de empleado digital (ADR 0019 · Inc.1). Publicar/descubrir/instalar plantillas GOBERNADAS.
 * Invariantes no negociables de este módulo:
 *  - **Humano en el origen:** publicar e instalar exige `auth.userId` (nunca un agente ni API key sin usuario): respeta
 *    `AGENTE_NO_CREA_AGENTES` (ADR 0016) además del `@MinRole('EDITOR')` del controlador.
 *  - **Sin secretos ni responsable:** el payload se SANEA; nunca contiene secretos, credenciales, responsable/suplente,
 *    dueño, centro de costo ni estación. Las referencias de operación son POR CAPACIDAD, no por conector concreto.
 *  - **Instalar crea un BORRADOR sin responsable:** el agente nace en DRAFT, sin responsable (no se puede lanzar) y sin
 *    secretos; una persona debe asignar responsable y reconfigurar secretos por bóveda antes de lanzar (ADR 0007).
 *  - **Multi-tenant estricto:** todo filtra por `workspaceId` (de `@CurrentAuth`, nunca del cuerpo); una plantilla solo
 *    es visible e instalable en su propio workspace.
 *  - **Auditado (E13):** publicar e instalar escriben al `AuditLog` con actor humano, plantilla y versión.
 */
@Injectable()
export class AgentTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly agents: AgentsService,
  ) {}

  /** Exige un humano identificado. Refuerza "humano en el origen" más allá del `@MinRole`. */
  private exigirHumano(auth: AuthContext): string {
    if (auth.via !== 'jwt' || !auth.userId) {
      throw new ForbiddenException(
        'Solo un humano puede publicar o instalar plantillas (ningún agente crea empleados digitales)',
      );
    }
    return auth.userId;
  }

  // --- Descubrir ----------------------------------------------------------------------------------------------------

  /** Catálogo del workspace (aislamiento estricto). Incluye el número de versiones. */
  async list(workspaceId: string) {
    const templates = await this.prisma.agentTemplate.findMany({
      where: { workspaceId },
      include: { _count: { select: { versiones: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return templates.map(({ _count, ...t }) => ({ ...t, versionesCount: _count.versiones }));
  }

  /** Detalle con sus versiones (orden ascendente). 404 si no es del workspace. */
  async get(workspaceId: string, id: string) {
    const template = await this.prisma.agentTemplate.findFirst({
      where: { id, workspaceId },
      include: { versiones: { orderBy: { version: 'asc' } } },
    });
    if (!template) throw new NotFoundException('Plantilla de agente no encontrada');
    return template;
  }

  // --- Publicar -----------------------------------------------------------------------------------------------------

  /**
   * Publica una plantilla a partir de un agente del workspace. Si ya existe una plantilla para ese agente, agrega una
   * versión nueva (correlativa); si no, crea la plantilla con su versión 1. El payload se SANEA (sin secretos, sin
   * responsable). Auditado.
   */
  async publish(auth: AuthContext, dto: PublishAgentTemplateDto) {
    const userId = this.exigirHumano(auth);
    const workspaceId = auth.workspaceId;
    // `agents.get` filtra por workspaceId (404 si el agente no es del workspace): mantiene el aislamiento multi-tenant.
    const agent = await this.agents.get(workspaceId, dto.agentId);
    const nivel = await this.cargoNivel(workspaceId, agent.cargoId);
    const payload = this.sanitizePayload(agent, nivel);

    const existing = await this.prisma.agentTemplate.findFirst({
      where: { workspaceId, sourceAgentId: agent.id },
      orderBy: { createdAt: 'asc' },
    });

    const { template, version } = await this.prisma.$transaction(async (tx) => {
      const tpl = existing
        ? await tx.agentTemplate.update({
            where: { id: existing.id },
            data: {
              nombre: dto.nombre?.trim() || existing.nombre,
              ...(dto.area !== undefined ? { area: dto.area.trim() || null } : {}),
              nivel: nivel as never,
              updatedAt: new Date(),
            },
          })
        : await tx.agentTemplate.create({
            data: {
              workspaceId,
              nombre: dto.nombre?.trim() || agent.name,
              descripcion: agent.description ?? null,
              area: dto.area?.trim() || null,
              nivel: nivel as never,
              sourceAgentId: agent.id,
              publicadoPorUserId: userId,
            },
          });

      const last = await tx.agentTemplateVersion.findFirst({
        where: { workspaceId, templateId: tpl.id },
        orderBy: { version: 'desc' },
      });
      const numero = (last?.version ?? 0) + 1;
      const ver = await tx.agentTemplateVersion.create({
        data: {
          workspaceId,
          templateId: tpl.id,
          version: numero,
          payload: payload as unknown as Prisma.InputJsonValue,
          notas: dto.notas?.trim() || null,
          publicadoPorUserId: userId,
        },
      });
      return { template: tpl, version: ver };
    });

    await this.audit.append(workspaceId, {
      actorType: 'USER',
      actorId: userId,
      action: AUDIT_ACTIONS.AGENTE_PLANTILLA_PUBLICADA,
      targetType: 'AgentTemplate',
      targetId: template.id,
      resumen: `Plantilla de agente "${template.nombre}" publicada (versión ${version.version})`,
      metadata: { versionId: version.id, version: version.version, sourceAgentId: agent.id },
    });
    return this.get(workspaceId, template.id);
  }

  /**
   * Payload SANEADO de un agente: perfil/prompt, skills (por slug), operaciones por capacidad y parámetros de ejecución
   * recomendados. NUNCA incluye secretos, responsable/suplente, dueño, centro de costo ni estación.
   */
  private sanitizePayload(agent: Awaited<ReturnType<AgentsService['get']>>, nivel: string | null): TemplatePayload {
    const operaciones = (agent.tools ?? []).map((t) => ({
      // Capacidad, no conector concreto: el instalador la vuelve a resolver en SU workspace (ADR 0019).
      connectorType: t.operation.connector.type,
      operationKey: t.operation.key,
      operationName: t.operation.name,
    }));
    const skills = (agent.skills ?? []).map((s) => ({ slug: s.skill.slug, name: s.skill.name }));
    // Parámetros recomendados: se excluyen los candados sensibles de salida a internet (navegacionWeb/sistemasAutorizados
    // son concesiones explícitas y auditadas; nunca se habilitan al instalar).
    const parametros = (agent.parametrosEjecucion as Record<string, unknown> | null) ?? {};
    return {
      cargo: { cargoId: agent.cargoId ?? null, nivel },
      perfil: {
        provider: agent.provider,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        effort: agent.effort,
        maxTurns: agent.maxTurns,
        profile: agent.profile ?? {},
        fallbackModels: agent.fallbackModels ?? [],
        routing: agent.routing ?? null,
        targetScore: agent.targetScore,
      },
      skills,
      operaciones,
      parametrosEjecucionRecomendados: parametros,
    };
  }

  /** Nivel jerárquico del cargo del agente (referencia descriptiva para la plantilla). null si no tiene cargo. */
  private async cargoNivel(workspaceId: string, cargoId: string | null): Promise<string | null> {
    if (!cargoId) return null;
    const cargo = await this.prisma.cargo.findFirst({ where: { id: cargoId, workspaceId }, select: { nivel: true } });
    return cargo?.nivel ?? null;
  }

  // --- Instalar -----------------------------------------------------------------------------------------------------

  /**
   * Instala una versión de la plantilla creando un agente BORRADOR en el workspace actual. Reutiliza
   * `AgentsService.create` (misma lógica de alta: DRAFT, dueño = instalador, visibilidad inicial) y luego fija skills y
   * operaciones que EXISTAN en el workspace. El agente nace SIN responsable (no se puede lanzar) y SIN secretos; una
   * persona debe asignar responsable y reconfigurar secretos por bóveda antes de lanzar. Devuelve el id del agente.
   */
  async install(auth: AuthContext, templateId: string, dto: InstallAgentTemplateDto) {
    const userId = this.exigirHumano(auth);
    const workspaceId = auth.workspaceId;
    const template = await this.get(workspaceId, templateId);
    const version = dto.version
      ? template.versiones.find((v) => v.version === dto.version)
      : template.versiones[template.versiones.length - 1];
    if (!version) throw new NotFoundException('Versión de plantilla no encontrada');

    const payload = version.payload as unknown as TemplatePayload;
    const perfil = payload.perfil;
    // El cargo es una referencia blanda: solo se adopta si existe en ESTE workspace (no concede acceso).
    const cargoId = await this.resolveCargo(workspaceId, payload.cargo?.cargoId ?? null);

    // Alta reutilizando la lógica existente. SIN responsableUserId/suplenteUserId: el borrador no se puede lanzar.
    const createDto: CreateAgentDto = {
      name: template.nombre.slice(0, 80),
      description: template.descripcion ?? undefined,
      provider: perfil?.provider,
      model: perfil?.model,
      systemPrompt: perfil?.systemPrompt,
      effort: perfil?.effort as CreateAgentDto['effort'],
      maxTurns: perfil?.maxTurns,
      profile: perfil?.profile as CreateAgentDto['profile'],
      fallbackModels: perfil?.fallbackModels,
      routing: perfil?.routing as CreateAgentDto['routing'],
      targetScore: perfil?.targetScore,
      ...(cargoId ? { cargoId } : {}),
    };
    const agent = await this.agents.create(auth, createDto);

    // Skills: se adoptan las que existan en el workspace (por slug). Instalar no crea skills nuevas.
    const skillIds = await this.resolveSkills(workspaceId, payload.skills ?? []);
    if (skillIds.length) await this.agents.setSkills(workspaceId, agent.id, { skillIds });

    // Operaciones por capacidad: se vinculan las que existan en el workspace (mismo tipo de conector + clave). No
    // concede el secreto del conector: la bóveda se reconfigura aparte antes de lanzar.
    const operationIds = await this.resolveOperations(workspaceId, payload.operaciones ?? []);
    if (operationIds.length) {
      await this.agents.setTools(workspaceId, agent.id, {
        tools: operationIds.map((operationId) => ({ operationId })),
      });
    }

    // Parámetros de ejecución recomendados (sin tocar los candados sensibles de salida a internet, que siguen en false).
    const recomendados = payload.parametrosEjecucionRecomendados ?? {};
    if (recomendados && Object.keys(recomendados).length) {
      await this.prisma.agent.update({
        where: { id: agent.id },
        data: { parametrosEjecucion: recomendados as Prisma.InputJsonValue },
      });
    }

    await this.audit.append(workspaceId, {
      actorType: 'USER',
      actorId: userId,
      action: AUDIT_ACTIONS.AGENTE_PLANTILLA_INSTALADA,
      targetType: 'Agent',
      targetId: agent.id,
      resumen: `Agente BORRADOR instalado desde la plantilla "${template.nombre}" (versión ${version.version})`,
      metadata: { templateId: template.id, versionId: version.id, version: version.version, agentId: agent.id },
    });

    return {
      agentId: agent.id,
      templateId: template.id,
      version: version.version,
      skillsVinculadas: skillIds.length,
      operacionesVinculadas: operationIds.length,
      aviso:
        'El agente se creó en BORRADOR, SIN responsable y SIN secretos. Asigne un responsable humano y reconfigure ' +
        'los secretos de conector por la bóveda antes de lanzarlo; instalar no concede accesos ni visibilidad.',
    };
  }

  /** Adopta el cargo solo si existe en el workspace destino (referencia blanda). */
  private async resolveCargo(workspaceId: string, cargoId: string | null): Promise<string | null> {
    if (!cargoId) return null;
    const cargo = await this.prisma.cargo.findFirst({ where: { id: cargoId, workspaceId }, select: { id: true } });
    return cargo?.id ?? null;
  }

  /** Mapea slugs de skill a ids del workspace destino (solo las que existen). */
  private async resolveSkills(workspaceId: string, skills: TemplateSkill[]): Promise<string[]> {
    const slugs = [...new Set(skills.map((s) => s.slug).filter((s): s is string => !!s))];
    if (!slugs.length) return [];
    const found = await this.prisma.skill.findMany({
      where: { workspaceId, slug: { in: slugs } },
      select: { id: true },
    });
    return found.map((s) => s.id);
  }

  /** Mapea capacidades (tipo de conector + clave de operación) a ids de operación del workspace destino. */
  private async resolveOperations(workspaceId: string, operaciones: TemplateOperacion[]): Promise<string[]> {
    if (!operaciones.length) return [];
    const keys = [...new Set(operaciones.map((o) => o.operationKey).filter((k): k is string => !!k))];
    const types = [...new Set(operaciones.map((o) => o.connectorType).filter((t): t is string => !!t))];
    if (!keys.length) return [];
    const found = await this.prisma.connectorOperation.findMany({
      where: {
        key: { in: keys },
        connector: { workspaceId, type: { in: types as never } },
      },
      select: { id: true, key: true, connector: { select: { type: true } } },
    });
    // Una operación por capacidad (primera coincidencia tipo+clave): evita duplicar herramientas al instalar.
    const byCapability = new Map<string, string>();
    for (const op of found) {
      const cap = `${op.connector.type}:${op.key}`;
      if (!byCapability.has(cap)) byCapability.set(cap, op.id);
    }
    const ids: string[] = [];
    for (const o of operaciones) {
      const id = byCapability.get(`${o.connectorType}:${o.operationKey}`);
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }
}
