import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type CuadrillaMiembro, type CuadrillaPlantilla } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import type { CreateCrewDto, CreateCrewVersionDto, CrewMemberDto, InstantiateCrewDto } from './dto/crew.dto';
import { inspeccionarDeclarativo } from './crews.validator';

/** Normaliza una lista de textos: recorta, descarta vacíos. */
function cleanList(values: string[] | undefined): string[] {
  return (values ?? []).map((v) => v.trim()).filter((v) => v.length > 0);
}

/**
 * Cuadrillas (ADR 0014 · D1 · E11): plantillas de equipo de empleados digitales GOBERNADAS, versionadas y 100 %
 * DECLARATIVAS. CRUD de plantillas, versiones append-only, ciclo `BORRADOR→PUBLICADA→RETIRADA` e instanciación por un
 * humano. Invariantes clave de este módulo:
 *  - **Humano en el origen:** definir/publicar/retirar/instanciar exige `auth.userId` (nunca un agente ni una API key
 *    sin usuario): respeta `AGENTE_NO_CREA_AGENTES` de E5 además del `@MinRole` del controlador.
 *  - **Solo declarativo:** cada versión/miembro pasa por `inspeccionarDeclarativo`; una clave o contenido ejecutable
 *    (hooks, eval, exec, command, script, code, URLs de arranque, funciones) se rechaza con `400` y motivo auditable.
 *  - **Instanciar NO concede acceso:** crea agentes en BORRADOR sin ningún share/conector/secreto; los conectores/skills
 *    del miembro son SUGERENCIAS que vuelven como "permisos pendientes de conceder" por el camino normal (ADR 0007).
 *  - **Multi-tenant:** todo filtra por `workspaceId` (de `@CurrentAuth`, nunca del cuerpo).
 *  - **Auditado (E13):** alta/publicación/retiro/instanciación escriben al `AuditLog` con actor humano, plantilla y versión.
 */
@Injectable()
export class CrewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Exige que el actor sea un humano identificado. Refuerza "humano en el origen" más allá del `@MinRole`. */
  private exigirHumano(auth: AuthContext): string {
    if (!auth.userId) {
      throw new ForbiddenException('Solo un humano puede gobernar Cuadrillas (ningún agente crea empleados digitales)');
    }
    return auth.userId;
  }

  // --- CRUD de plantillas -------------------------------------------------------------------------------------------

  /** Catálogo gobernado, acotado al workspace. Filtra por estado si se indica. */
  async list(workspaceId: string, estado?: string) {
    const plantillas = await this.prisma.cuadrillaPlantilla.findMany({
      where: { workspaceId, ...(estado ? { estado: estado as never } : {}) },
      include: { _count: { select: { versiones: true, instancias: true } } },
      orderBy: [{ updatedAt: 'desc' }],
    });
    return plantillas.map(({ _count, ...p }) => ({
      ...p,
      versionesCount: _count.versiones,
      instanciasCount: _count.instancias,
    }));
  }

  async get(workspaceId: string, id: string) {
    const plantilla = await this.prisma.cuadrillaPlantilla.findFirst({
      where: { id, workspaceId },
      include: {
        versiones: { orderBy: { version: 'asc' }, include: { miembros: { orderBy: { createdAt: 'asc' } } } },
      },
    });
    if (!plantilla) throw new NotFoundException('Cuadrilla no encontrada');
    return plantilla;
  }

  /** Garantiza que la plantilla pertenece al workspace. */
  private async assertPlantilla(workspaceId: string, id: string): Promise<CuadrillaPlantilla> {
    const plantilla = await this.prisma.cuadrillaPlantilla.findFirst({ where: { id, workspaceId } });
    if (!plantilla) throw new NotFoundException('Cuadrilla no encontrada');
    return plantilla;
  }

  async create(auth: AuthContext, dto: CreateCrewDto) {
    const userId = this.exigirHumano(auth);
    const plantilla = await this.prisma.cuadrillaPlantilla.create({
      data: {
        workspaceId: auth.workspaceId,
        nombre: dto.nombre.trim(),
        proposito: dto.proposito?.trim() || null,
        procesoObjetivo: dto.procesoObjetivo?.trim() || null,
        orgUnitId: dto.orgUnitId ?? null,
        estado: 'BORRADOR',
        creadaPorUserId: userId,
      },
    });
    await this.audit.append(auth.workspaceId, {
      actorType: 'USER',
      actorId: userId,
      action: AUDIT_ACTIONS.CUADRILLA_CREADA,
      targetType: 'CuadrillaPlantilla',
      targetId: plantilla.id,
      resumen: `Cuadrilla "${plantilla.nombre}" creada en BORRADOR`,
      metadata: { nombre: plantilla.nombre, orgUnitId: plantilla.orgUnitId },
    });
    return this.get(auth.workspaceId, plantilla.id);
  }

  // --- Versiones (append-only) --------------------------------------------------------------------------------------

  /**
   * Crea una versión NUEVA con sus miembros (append-only; nunca reescribe una anterior). Valida que toda la definición y
   * cada miembro sean declarativos antes de persistir. El número de versión es monotónico por plantilla.
   */
  async addVersion(auth: AuthContext, plantillaId: string, dto: CreateCrewVersionDto) {
    this.exigirHumano(auth);
    const plantilla = await this.assertPlantilla(auth.workspaceId, plantillaId);
    if (plantilla.estado === 'RETIRADA') {
      throw new ConflictException('No se agregan versiones a una Cuadrilla RETIRADA');
    }

    // Seguridad central: rechazar cualquier clave/contenido ejecutable en la definición y en cada miembro.
    this.rechazarSiNoDeclarativo('definicion', dto.definicion ?? {});
    dto.miembros.forEach((m, i) => this.rechazarSiNoDeclarativo(`miembros[${i}]`, this.miembroDeclarativo(m)));

    const ultima = await this.prisma.cuadrillaVersion.findFirst({
      where: { workspaceId: auth.workspaceId, plantillaId },
      orderBy: { version: 'desc' },
    });
    const numero = (ultima?.version ?? 0) + 1;

    const version = await this.prisma.cuadrillaVersion.create({
      data: {
        workspaceId: auth.workspaceId,
        plantillaId,
        version: numero,
        definicion: (dto.definicion ?? {}) as Prisma.InputJsonValue,
        miembros: {
          create: dto.miembros.map((m) => ({
            workspaceId: auth.workspaceId,
            rol: m.rol.trim(),
            cargoId: m.cargoId ?? null,
            nivelEsperado: m.nivelEsperado ?? null,
            skills: cleanList(m.skills),
            conectoresSugeridos: (m.conectoresSugeridos ?? []) as Prisma.InputJsonValue,
            politicaSugerida: (m.politicaSugerida ?? {}) as Prisma.InputJsonValue,
            criteriosResultado: (m.criteriosResultado ?? {}) as Prisma.InputJsonValue,
            delegaA: cleanList(m.delegaA),
          })),
        },
      },
      include: { miembros: { orderBy: { createdAt: 'asc' } } },
    });
    return version;
  }

  /** Objeto que resume la parte declarativa de un miembro, para inspeccionarla de una vez. */
  private miembroDeclarativo(m: CrewMemberDto): Record<string, unknown> {
    return {
      rol: m.rol,
      cargoId: m.cargoId,
      nivelEsperado: m.nivelEsperado,
      skills: m.skills ?? [],
      conectoresSugeridos: m.conectoresSugeridos ?? [],
      politicaSugerida: m.politicaSugerida ?? {},
      criteriosResultado: m.criteriosResultado ?? {},
      delegaA: m.delegaA ?? [],
    };
  }

  /** Aplica el validador puro; traduce un rechazo a `400` con motivo y ruta auditables. */
  private rechazarSiNoDeclarativo(ambito: string, valor: unknown): void {
    const r = inspeccionarDeclarativo(valor, `$.${ambito}`);
    if (!r.ok) {
      throw new BadRequestException(
        `Definición de Cuadrilla no declarativa en ${r.ruta}: ${r.motivo}. Una Cuadrilla no admite código, hooks ni URLs de arranque.`,
      );
    }
  }

  // --- Ciclo de vida ------------------------------------------------------------------------------------------------

  /** BORRADOR→PUBLICADA. Exige al menos una versión con miembros. Marca la última versión como publicada. */
  async publish(auth: AuthContext, plantillaId: string) {
    const userId = this.exigirHumano(auth);
    const plantilla = await this.assertPlantilla(auth.workspaceId, plantillaId);
    if (plantilla.estado === 'PUBLICADA') return this.get(auth.workspaceId, plantillaId);
    if (plantilla.estado === 'RETIRADA') {
      throw new ConflictException('Una Cuadrilla RETIRADA no se puede publicar');
    }

    const version = await this.prisma.cuadrillaVersion.findFirst({
      where: { workspaceId: auth.workspaceId, plantillaId },
      orderBy: { version: 'desc' },
      include: { _count: { select: { miembros: true } } },
    });
    if (!version || version._count.miembros === 0) {
      throw new ConflictException('Publicar exige al menos una versión válida con miembros');
    }

    await this.prisma.$transaction([
      this.prisma.cuadrillaPlantilla.update({ where: { id: plantillaId }, data: { estado: 'PUBLICADA' } }),
      // La versión publicada queda sellada (inmutable): registra quién y cuándo. Nunca se reescribe su configuración.
      this.prisma.cuadrillaVersion.update({
        where: { id: version.id },
        data: { publicadaPorUserId: userId, publicadaAt: new Date() },
      }),
    ]);

    await this.audit.append(auth.workspaceId, {
      actorType: 'USER',
      actorId: userId,
      action: AUDIT_ACTIONS.CUADRILLA_PUBLICADA,
      targetType: 'CuadrillaPlantilla',
      targetId: plantillaId,
      resumen: `Cuadrilla "${plantilla.nombre}" publicada (versión ${version.version})`,
      metadata: { versionId: version.id, version: version.version },
    });
    return this.get(auth.workspaceId, plantillaId);
  }

  /** →RETIRADA. No rompe instancias existentes; solo deja de ofrecerse para instanciar. */
  async retire(auth: AuthContext, plantillaId: string) {
    const userId = this.exigirHumano(auth);
    const plantilla = await this.assertPlantilla(auth.workspaceId, plantillaId);
    if (plantilla.estado === 'RETIRADA') return this.get(auth.workspaceId, plantillaId);

    await this.prisma.cuadrillaPlantilla.update({ where: { id: plantillaId }, data: { estado: 'RETIRADA' } });
    await this.audit.append(auth.workspaceId, {
      actorType: 'USER',
      actorId: userId,
      action: AUDIT_ACTIONS.CUADRILLA_RETIRADA,
      targetType: 'CuadrillaPlantilla',
      targetId: plantillaId,
      resumen: `Cuadrilla "${plantilla.nombre}" retirada`,
      metadata: {},
    });
    return this.get(auth.workspaceId, plantillaId);
  }

  // --- Instanciación gobernada --------------------------------------------------------------------------------------

  /**
   * Instancia una versión PUBLICADA (solo PUBLICADA se instancia). Crea un `Agent` en estado BORRADOR por cada miembro,
   * vinculado a su `cargoId` y al responsable humano que traiga el DTO, SIN conceder ningún share/conector/secreto.
   * Devuelve la `CuadrillaInstancia` y la lista de PERMISOS PENDIENTES de conceder por el camino normal (ADR 0007): los
   * conectores/skills del miembro son SUGERENCIAS, no concesiones. La delegación intra-cuadrilla (`delegaA`) se persiste
   * de forma declarativa; su ejecución la gobierna E5 en runtime (fuera de este incremento).
   */
  async instantiate(auth: AuthContext, plantillaId: string, dto: InstantiateCrewDto) {
    const userId = this.exigirHumano(auth);
    const plantilla = await this.assertPlantilla(auth.workspaceId, plantillaId);
    if (plantilla.estado !== 'PUBLICADA') {
      throw new ConflictException('Solo una Cuadrilla PUBLICADA se puede instanciar');
    }

    const version = dto.versionId
      ? await this.prisma.cuadrillaVersion.findFirst({
          where: { id: dto.versionId, workspaceId: auth.workspaceId, plantillaId },
          include: { miembros: { orderBy: { createdAt: 'asc' } } },
        })
      : await this.prisma.cuadrillaVersion.findFirst({
          where: { workspaceId: auth.workspaceId, plantillaId },
          orderBy: { version: 'desc' },
          include: { miembros: { orderBy: { createdAt: 'asc' } } },
        });
    if (!version) throw new NotFoundException('Versión de Cuadrilla no encontrada');

    const responsablePorRol = new Map((dto.responsables ?? []).map((r) => [r.rol, r.responsableUserId]));
    const orgUnitId = dto.orgUnitId ?? plantilla.orgUnitId ?? null;

    // Un agente por miembro, en BORRADOR (LaunchStatus DRAFT), SIN permisos. No se crea ningún AgentTool/AgentSkill/
    // AgentShare: instanciar no concede acceso. El acceso efectivo lo sigue resolviendo AgentAccessService.
    const agentesCreados: string[] = [];
    const permisosPendientes: {
      agentId: string;
      rol: string;
      cargoId: string | null;
      skills: string[];
      conectoresSugeridos: unknown;
      politicaSugerida: unknown;
    }[] = [];

    for (const m of version.miembros) {
      const agent = await this.prisma.agent.create({
        data: {
          workspaceId: auth.workspaceId,
          name: `${plantilla.nombre} · ${m.rol}`,
          description: `Instanciado de la Cuadrilla "${plantilla.nombre}" (versión ${version.version}). Sin permisos concedidos.`,
          launchStatus: 'DRAFT',
          cargoId: m.cargoId ?? null,
          responsableUserId: responsablePorRol.get(m.rol) ?? null,
          costCenterId: orgUnitId,
        },
      });
      agentesCreados.push(agent.id);
      permisosPendientes.push({
        agentId: agent.id,
        rol: m.rol,
        cargoId: m.cargoId ?? null,
        skills: m.skills,
        // Referencias SUGERIDAS que un humano debe conceder aparte (shares USE|EDIT, instalación de conector con bóveda).
        conectoresSugeridos: m.conectoresSugeridos,
        politicaSugerida: m.politicaSugerida,
      });
    }

    const instancia = await this.prisma.cuadrillaInstancia.create({
      data: {
        workspaceId: auth.workspaceId,
        plantillaId,
        versionId: version.id,
        instanciadaPorUserId: userId,
        orgUnitId,
        agentesCreados,
        // Objetivos iniciales: fuera del alcance de este incremento (evita acoplar el dominio de results/). TODO(E4):
        // crear los Objetivo/Tarea/ContratoResultado iniciales desde `criteriosResultado` declarativos de cada miembro.
        objetivosCreados: [],
      },
    });

    await this.audit.append(auth.workspaceId, {
      actorType: 'USER',
      actorId: userId,
      action: AUDIT_ACTIONS.CUADRILLA_INSTANCIADA,
      targetType: 'CuadrillaInstancia',
      targetId: instancia.id,
      resumen: `Cuadrilla "${plantilla.nombre}" instanciada (versión ${version.version}); ${agentesCreados.length} agente(s) en BORRADOR sin permisos`,
      metadata: { plantillaId, versionId: version.id, version: version.version, agentesCreados },
    });

    return {
      instancia,
      agentesCreados,
      // El contrato deja EXPLÍCITO que instanciar NO concede acceso: estos permisos quedan por conceder a mano.
      permisosPendientes,
      aviso:
        'Instanciar NO concede acceso a datos. Los conectores/operaciones, skills y políticas listados son SUGERENCIAS: ' +
        'concédalos por el camino normal (shares USE|EDIT, instalación de conector con su secreto de bóveda). ' +
        'Un agente recién instanciado sin permisos concedidos no puede tocar ningún dato.',
    };
  }

  /** Lista las instancias de una plantilla (trazabilidad plantilla@versión -> agentes creados). */
  async listInstancias(workspaceId: string, plantillaId: string) {
    await this.assertPlantilla(workspaceId, plantillaId);
    return this.prisma.cuadrillaInstancia.findMany({
      where: { workspaceId, plantillaId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Expuesto para otras capas que necesiten validar miembros sueltos (p. ej. futuros editores incrementales). */
  validarMiembro(m: CuadrillaMiembro): void {
    this.rechazarSiNoDeclarativo('miembro', {
      conectoresSugeridos: m.conectoresSugeridos,
      politicaSugerida: m.politicaSugerida,
      criteriosResultado: m.criteriosResultado,
    });
  }
}
