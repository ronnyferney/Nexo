import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import { CrewsService } from '../crews/crews.service';
import { inspeccionarDeclarativo } from '../crews/crews.validator';
import type { CrewMemberDto } from '../crews/dto/crew.dto';
import type { InstallCrewTemplateDto, PublishCrewTemplateDto } from './dto/crew-template.dto';

/** Un rol del equipo dentro de la composición saneada de la plantilla (declarativo: nunca secretos ni responsables). */
interface CrewTemplateMiembro {
  rol: string;
  /** Cargo que desempeña el rol (ADR 0011). Referencia PORTABLE/blanda: se adopta en el workspace destino si existe. */
  cargoId: string | null;
  nivelEsperado: string | null;
  /** Referencias de skill PORTABLES (por slug/id declarativo). SUGERENCIA, no concesión. */
  skills: string[];
  /** Referencias a conector/operación SUGERIDAS (declarativo). Nunca una concesión de acceso ni un secreto. */
  conectoresSugeridos: unknown;
  /** Referencia/forma declarativa de `Politica` (E6) sugerida. */
  politicaSugerida: unknown;
  /** Forma declarativa de `ContratoResultado` (reglaValidacion, evidenciaExigida). */
  criteriosResultado: unknown;
  /** Roles a los que puede delegar (subconjunto declarativo). */
  delegaA: string[];
}

/** Payload declarativo y saneado de una versión de plantilla de cuadrilla (composición que se persiste y se reinstala). */
interface CrewTemplatePayload {
  proposito: string | null;
  procesoObjetivo: string | null;
  /** Metadatos declarativos de la versión (notas, criterios globales). Nunca código/hooks/URLs de arranque. */
  definicion: Record<string, unknown>;
  /** Reglas de composición del equipo: los miembros (cargos/roles) con sus referencias portables. */
  miembros: CrewTemplateMiembro[];
}

/**
 * Agent Hub · plantillas de CUADRILLA (ADR 0019 · Inc.3). Publicar/descubrir/instalar composiciones GOBERNADAS de varios
 * cargos/roles (ADR 0014). Reutiliza el patrón de `agent-templates` (Inc.1) y la validación declarativa de `crews`.
 * Invariantes no negociables de este módulo:
 *  - **Humano en el origen:** publicar e instalar exige `auth.userId` por JWT (nunca un agente ni API key sin usuario):
 *    respeta `AGENTE_NO_CREA_AGENTES` (ADR 0016) además del `@MinRole('EDITOR')` del controlador.
 *  - **Sin secretos ni responsables:** el payload empaqueta SOLO la composición declarativa (la `CuadrillaMiembro` de
 *    origen ya es declarativa y no guarda responsables ni credenciales); se valida con `crews.validator`.
 *  - **Instalar crea un BORRADOR gobernado:** la cuadrilla nace en BORRADOR, SIN responsables asignados; una persona
 *    debe completar responsables, conceder accesos y publicarla/instanciarla aparte (ADR 0007).
 *  - **Reutiliza `crews`:** la cuadrilla y su versión se crean por `CrewsService` (no se duplica la lógica de alta ni la
 *    validación declarativa de miembros).
 *  - **Multi-tenant estricto:** todo filtra por `workspaceId` (de `@CurrentAuth`, nunca del cuerpo); una plantilla solo
 *    es visible e instalable en su propio workspace.
 *  - **Auditado (E13):** publicar e instalar escriben al `AuditLog` con actor humano, plantilla y versión.
 */
@Injectable()
export class CrewTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crews: CrewsService,
  ) {}

  /** Exige un humano identificado por JWT. Refuerza "humano en el origen" más allá del `@MinRole`. */
  private exigirHumano(auth: AuthContext): string {
    if (auth.via !== 'jwt' || !auth.userId) {
      throw new ForbiddenException(
        'Solo un humano puede publicar o instalar plantillas de cuadrilla (ningún agente crea empleados digitales)',
      );
    }
    return auth.userId;
  }

  // --- Descubrir ----------------------------------------------------------------------------------------------------

  /** Catálogo del workspace (aislamiento estricto). Incluye el número de versiones. */
  async list(workspaceId: string) {
    const templates = await this.prisma.crewTemplate.findMany({
      where: { workspaceId },
      include: { _count: { select: { versiones: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return templates.map(({ _count, ...t }) => ({ ...t, versionesCount: _count.versiones }));
  }

  /** Detalle con sus versiones (orden ascendente). 404 si no es del workspace. */
  async get(workspaceId: string, id: string) {
    const template = await this.prisma.crewTemplate.findFirst({
      where: { id, workspaceId },
      include: { versiones: { orderBy: { version: 'asc' } } },
    });
    if (!template) throw new NotFoundException('Plantilla de cuadrilla no encontrada');
    return template;
  }

  // --- Publicar -----------------------------------------------------------------------------------------------------

  /**
   * Publica una plantilla a partir de una Cuadrilla del workspace. Si ya existe una plantilla para esa cuadrilla, agrega
   * una versión nueva (correlativa); si no, crea la plantilla con su versión 1. El payload empaqueta la composición
   * saneada de la ÚLTIMA versión de la cuadrilla (sin secretos, sin responsables). Auditado.
   */
  async publish(auth: AuthContext, dto: PublishCrewTemplateDto) {
    const userId = this.exigirHumano(auth);
    const workspaceId = auth.workspaceId;

    // `crews.get` filtra por workspaceId (404 si la cuadrilla no es del workspace): mantiene el aislamiento multi-tenant.
    const cuadrilla = await this.crews.get(workspaceId, dto.cuadrillaId);
    const ultima = cuadrilla.versiones[cuadrilla.versiones.length - 1];
    if (!ultima || ultima.miembros.length === 0) {
      throw new BadRequestException('La cuadrilla no tiene una versión con miembros que publicar');
    }
    const payload = this.sanitizePayload(cuadrilla, ultima);

    const existing = await this.prisma.crewTemplate.findFirst({
      where: { workspaceId, sourceCuadrillaId: cuadrilla.id },
      orderBy: { createdAt: 'asc' },
    });

    const { template, version } = await this.prisma.$transaction(async (tx) => {
      const tpl = existing
        ? await tx.crewTemplate.update({
            where: { id: existing.id },
            data: { nombre: dto.nombre?.trim() || existing.nombre, updatedAt: new Date() },
          })
        : await tx.crewTemplate.create({
            data: {
              workspaceId,
              nombre: dto.nombre?.trim() || cuadrilla.nombre,
              descripcion: cuadrilla.proposito ?? null,
              sourceCuadrillaId: cuadrilla.id,
              publicadoPorUserId: userId,
            },
          });

      const last = await tx.crewTemplateVersion.findFirst({
        where: { workspaceId, templateId: tpl.id },
        orderBy: { version: 'desc' },
      });
      const numero = (last?.version ?? 0) + 1;
      const ver = await tx.crewTemplateVersion.create({
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
      action: AUDIT_ACTIONS.CUADRILLA_PLANTILLA_PUBLICADA,
      targetType: 'CrewTemplate',
      targetId: template.id,
      resumen: `Plantilla de cuadrilla "${template.nombre}" publicada (versión ${version.version})`,
      metadata: { versionId: version.id, version: version.version, sourceCuadrillaId: cuadrilla.id },
    });
    return this.get(workspaceId, template.id);
  }

  /**
   * Payload SANEADO de una cuadrilla: propósito/proceso, metadatos declarativos de la versión y la composición de
   * miembros (cargos/roles, referencias portables de skills/conectores/política/criterios SUGERIDAS y delegación).
   * NUNCA incluye secretos, responsables ni credenciales (la `CuadrillaMiembro` de origen tampoco los guarda).
   */
  private sanitizePayload(
    cuadrilla: Awaited<ReturnType<CrewsService['get']>>,
    version: Awaited<ReturnType<CrewsService['get']>>['versiones'][number],
  ): CrewTemplatePayload {
    const miembros: CrewTemplateMiembro[] = version.miembros.map((m) => ({
      rol: m.rol,
      cargoId: m.cargoId ?? null,
      nivelEsperado: m.nivelEsperado ?? null,
      skills: m.skills ?? [],
      conectoresSugeridos: m.conectoresSugeridos ?? [],
      politicaSugerida: m.politicaSugerida ?? {},
      criteriosResultado: m.criteriosResultado ?? {},
      delegaA: m.delegaA ?? [],
    }));
    return {
      proposito: cuadrilla.proposito ?? null,
      procesoObjetivo: cuadrilla.procesoObjetivo ?? null,
      definicion: (version.definicion as Record<string, unknown> | null) ?? {},
      miembros,
    };
  }

  // --- Instalar -----------------------------------------------------------------------------------------------------

  /**
   * Instala una versión de la plantilla creando una Cuadrilla BORRADOR en el workspace actual con la composición de la
   * plantilla. Reutiliza `CrewsService.create` (alta en BORRADOR) y `CrewsService.addVersion` (que VALIDA la composición
   * con el validador declarativo de Cuadrillas y la rechaza con 400 si no es declarativa). NO asigna responsables: la
   * cuadrilla queda como borrador gobernado; una persona completa responsables y concede accesos antes de instanciarla.
   * Devuelve el id de la cuadrilla creada.
   */
  async install(auth: AuthContext, templateId: string, dto: InstallCrewTemplateDto) {
    const userId = this.exigirHumano(auth);
    const workspaceId = auth.workspaceId;
    const template = await this.get(workspaceId, templateId);
    const version = dto.version
      ? template.versiones.find((v) => v.version === dto.version)
      : template.versiones[template.versiones.length - 1];
    if (!version) throw new NotFoundException('Versión de plantilla de cuadrilla no encontrada');

    const payload = version.payload as unknown as CrewTemplatePayload;
    const miembros = payload?.miembros ?? [];
    if (!miembros.length) {
      throw new BadRequestException('La versión de la plantilla no tiene una composición con miembros');
    }

    // Defensa en profundidad: valida la composición antes de tocar `crews` (además de la validación de `addVersion`).
    const r = inspeccionarDeclarativo(payload, '$.payload');
    if (!r.ok) {
      throw new BadRequestException(
        `Composición de plantilla de cuadrilla no declarativa en ${r.ruta}: ${r.motivo}. ` +
          'Una cuadrilla no admite código, hooks ni URLs de arranque.',
      );
    }

    // Alta reutilizando `crews` (no se duplica la lógica): cuadrilla en BORRADOR, SIN responsables asignados.
    const plantilla = await this.crews.create(auth, {
      nombre: template.nombre.slice(0, 120),
      proposito: payload.proposito ?? undefined,
      procesoObjetivo: payload.procesoObjetivo ?? undefined,
    });

    // Versión con la composición de la plantilla. `addVersion` revalida declarativamente cada miembro (400 si no lo es).
    const miembrosDto: CrewMemberDto[] = miembros.map((m) => ({
      rol: m.rol,
      cargoId: m.cargoId ?? undefined,
      nivelEsperado: m.nivelEsperado ?? undefined,
      skills: m.skills ?? [],
      conectoresSugeridos: Array.isArray(m.conectoresSugeridos) ? (m.conectoresSugeridos as unknown[]) : [],
      politicaSugerida: (m.politicaSugerida as Record<string, unknown>) ?? {},
      criteriosResultado: (m.criteriosResultado as Record<string, unknown>) ?? {},
      delegaA: m.delegaA ?? [],
    }));
    await this.crews.addVersion(auth, plantilla.id, { definicion: payload.definicion ?? {}, miembros: miembrosDto });

    await this.audit.append(workspaceId, {
      actorType: 'USER',
      actorId: userId,
      action: AUDIT_ACTIONS.CUADRILLA_PLANTILLA_INSTALADA,
      targetType: 'CuadrillaPlantilla',
      targetId: plantilla.id,
      resumen: `Cuadrilla BORRADOR instalada desde la plantilla "${template.nombre}" (versión ${version.version})`,
      metadata: { templateId: template.id, versionId: version.id, version: version.version, cuadrillaId: plantilla.id },
    });

    return {
      cuadrillaId: plantilla.id,
      templateId: template.id,
      version: version.version,
      miembrosInstalados: miembros.length,
      aviso:
        'La cuadrilla se creó en BORRADOR, SIN responsables asignados y SIN accesos concedidos. Asigne responsables ' +
        'humanos por rol y conceda los accesos por el camino normal (shares, bóveda) antes de instanciarla; instalar ' +
        'no concede accesos ni visibilidad.',
    };
  }
}
