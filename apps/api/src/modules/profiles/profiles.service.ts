import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import type { CreateContactoDto, UpdateContactoDto } from './dto/contacto.dto';
import type { CreateMemoriaDto, UpdateMemoriaDto } from './dto/memoria.dto';
import type { CreateOrganizacionDto, UpdateOrganizacionDto } from './dto/organizacion.dto';

/** Recorta un texto opcional y lo convierte en `null` cuando queda vacío. */
function trimOrNull(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/** Normaliza una lista de textos: recorta y descarta vacíos. */
function cleanList(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  return values.map((v) => v.trim()).filter((v) => v.length > 0);
}

/** Normaliza correos: recorta, pasa a minúsculas y descarta vacíos. */
function cleanEmails(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  return values.map((v) => v.trim().toLowerCase()).filter((v) => v.length > 0);
}

/** `true` si el error de Prisma es una violación de restricción única (P2002). */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Memoria y perfiles gobernados (ADR 0018 Inc.1): perfiles de contacto/organización y memoria operativa por proceso.
 * Los perfiles son CONTEXTO, no conceden permisos y no admiten secretos. Todo filtra por `workspaceId` (multi-tenant):
 * un workspace no ve ni edita datos de otro. La PII (`correos`/`telefonos`) se guarda en claro en Inc.1; el cifrado de
 * campo y la purga por retención quedan para un incremento posterior (ADR 0008).
 */
@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────── Organizaciones ─────────────────────────────

  listOrganizaciones(workspaceId: string) {
    return this.prisma.organizacionPerfil.findMany({
      where: { workspaceId },
      orderBy: { nombre: 'asc' },
    });
  }

  async getOrganizacion(workspaceId: string, id: string) {
    const org = await this.prisma.organizacionPerfil.findFirst({
      where: { id, workspaceId },
      include: { contactos: { orderBy: { nombre: 'asc' } } },
    });
    if (!org) throw new NotFoundException('Organización no encontrada');
    return org;
  }

  async createOrganizacion(workspaceId: string, dto: CreateOrganizacionDto) {
    try {
      return await this.prisma.organizacionPerfil.create({
        data: {
          workspaceId,
          nombre: dto.nombre.trim(),
          dominio: trimOrNull(dto.dominio)?.toLowerCase() ?? null,
          tipoSector: trimOrNull(dto.tipoSector) ?? null,
          notas: trimOrNull(dto.notas) ?? null,
          fuente: trimOrNull(dto.fuente) ?? null,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Ya existe una organización con ese dominio');
      throw err;
    }
  }

  async updateOrganizacion(workspaceId: string, id: string, dto: UpdateOrganizacionDto) {
    await this.assertOrganizacion(workspaceId, id);
    try {
      return await this.prisma.organizacionPerfil.update({
        where: { id },
        data: {
          ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
          ...(dto.dominio !== undefined ? { dominio: trimOrNull(dto.dominio)?.toLowerCase() ?? null } : {}),
          ...(dto.tipoSector !== undefined ? { tipoSector: trimOrNull(dto.tipoSector) ?? null } : {}),
          ...(dto.notas !== undefined ? { notas: trimOrNull(dto.notas) ?? null } : {}),
          ...(dto.fuente !== undefined ? { fuente: trimOrNull(dto.fuente) ?? null } : {}),
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Ya existe una organización con ese dominio');
      throw err;
    }
  }

  async removeOrganizacion(workspaceId: string, id: string) {
    await this.assertOrganizacion(workspaceId, id);
    // Los contactos vinculados quedan con `organizacionId = null` (onDelete: SetNull).
    await this.prisma.organizacionPerfil.delete({ where: { id } });
  }

  private async assertOrganizacion(workspaceId: string, id: string) {
    const org = await this.prisma.organizacionPerfil.findFirst({ where: { id, workspaceId } });
    if (!org) throw new NotFoundException('Organización no encontrada');
    return org;
  }

  // ─────────────────────────────── Contactos ────────────────────────────────

  listContactos(workspaceId: string) {
    return this.prisma.contactoPerfil.findMany({
      where: { workspaceId },
      orderBy: { nombre: 'asc' },
    });
  }

  async getContacto(workspaceId: string, id: string) {
    const contacto = await this.prisma.contactoPerfil.findFirst({
      where: { id, workspaceId },
      include: { organizacion: true },
    });
    if (!contacto) throw new NotFoundException('Contacto no encontrado');
    return contacto;
  }

  /**
   * Resuelve el perfil de un contacto por su correo (Inc.2): lo consume la ficha del buzón para mostrar a quién escribe.
   * Busca por `correoPrincipal`; si no hay, cae a la lista `correos`. Normaliza el correo y filtra por workspace.
   */
  async getContactoPorCorreo(workspaceId: string, correo: string) {
    const correoNorm = correo.trim().toLowerCase();
    const porPrincipal = await this.prisma.contactoPerfil.findFirst({
      where: { workspaceId, correoPrincipal: correoNorm },
      include: { organizacion: true },
    });
    if (porPrincipal) return porPrincipal;
    const porLista = await this.prisma.contactoPerfil.findFirst({
      where: { workspaceId, correos: { array_contains: correoNorm } },
      include: { organizacion: true },
    });
    if (!porLista) throw new NotFoundException('No hay contacto con ese correo');
    return porLista;
  }

  /** Resuelve el perfil de la organización por su dominio (Inc.2): lo consume la ficha del buzón. Filtra por workspace. */
  async getOrganizacionPorDominio(workspaceId: string, dominio: string) {
    const org = await this.prisma.organizacionPerfil.findFirst({
      where: { workspaceId, dominio: dominio.trim().toLowerCase() },
      include: { contactos: { orderBy: { nombre: 'asc' } } },
    });
    if (!org) throw new NotFoundException('No hay organización con ese dominio');
    return org;
  }

  async createContacto(workspaceId: string, dto: CreateContactoDto) {
    if (dto.organizacionId) await this.assertOrganizacion(workspaceId, dto.organizacionId);
    const correoPrincipal = trimOrNull(dto.correoPrincipal)?.toLowerCase() ?? null;
    try {
      return await this.prisma.contactoPerfil.create({
        data: {
          workspaceId,
          nombre: dto.nombre.trim(),
          correoPrincipal,
          correos: cleanEmails(dto.correos) ?? (correoPrincipal ? [correoPrincipal] : []),
          telefonos: cleanList(dto.telefonos) ?? Prisma.JsonNull,
          idioma: trimOrNull(dto.idioma) ?? null,
          tono: trimOrNull(dto.tono) ?? null,
          organizacionId: dto.organizacionId ?? null,
          senales: cleanList(dto.senales) ?? Prisma.JsonNull,
          fuente: trimOrNull(dto.fuente) ?? null,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Ya existe un contacto con ese correo principal');
      throw err;
    }
  }

  async updateContacto(workspaceId: string, id: string, dto: UpdateContactoDto) {
    await this.assertContacto(workspaceId, id);
    if (dto.organizacionId) await this.assertOrganizacion(workspaceId, dto.organizacionId);
    try {
      return await this.prisma.contactoPerfil.update({
        where: { id },
        data: {
          ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
          ...(dto.correoPrincipal !== undefined
            ? { correoPrincipal: trimOrNull(dto.correoPrincipal)?.toLowerCase() ?? null }
            : {}),
          ...(dto.correos !== undefined ? { correos: cleanEmails(dto.correos) ?? [] } : {}),
          ...(dto.telefonos !== undefined ? { telefonos: cleanList(dto.telefonos) ?? Prisma.JsonNull } : {}),
          ...(dto.idioma !== undefined ? { idioma: trimOrNull(dto.idioma) ?? null } : {}),
          ...(dto.tono !== undefined ? { tono: trimOrNull(dto.tono) ?? null } : {}),
          ...(dto.organizacionId !== undefined ? { organizacionId: dto.organizacionId ?? null } : {}),
          ...(dto.senales !== undefined ? { senales: cleanList(dto.senales) ?? Prisma.JsonNull } : {}),
          ...(dto.fuente !== undefined ? { fuente: trimOrNull(dto.fuente) ?? null } : {}),
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Ya existe un contacto con ese correo principal');
      throw err;
    }
  }

  async removeContacto(workspaceId: string, id: string) {
    await this.assertContacto(workspaceId, id);
    await this.prisma.contactoPerfil.delete({ where: { id } });
  }

  private async assertContacto(workspaceId: string, id: string) {
    const contacto = await this.prisma.contactoPerfil.findFirst({ where: { id, workspaceId } });
    if (!contacto) throw new NotFoundException('Contacto no encontrado');
    return contacto;
  }

  // ──────────────────────────── Memoria operativa ───────────────────────────

  listMemorias(workspaceId: string, procesoClave?: string) {
    return this.prisma.memoriaOperativa.findMany({
      where: { workspaceId, ...(procesoClave ? { procesoClave } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMemoria(workspaceId: string, id: string) {
    const memoria = await this.prisma.memoriaOperativa.findFirst({ where: { id, workspaceId } });
    if (!memoria) throw new NotFoundException('Hecho de memoria no encontrado');
    return memoria;
  }

  createMemoria(workspaceId: string, dto: CreateMemoriaDto) {
    return this.prisma.memoriaOperativa.create({
      data: {
        workspaceId,
        procesoClave: dto.procesoClave.trim(),
        hecho: dto.hecho.trim(),
        fuente: trimOrNull(dto.fuente) ?? null,
        estado: dto.estado ?? 'PROPUESTO',
        caducaEn: dto.caducaEn ? new Date(dto.caducaEn) : null,
      },
    });
  }

  async updateMemoria(workspaceId: string, id: string, dto: UpdateMemoriaDto) {
    await this.getMemoria(workspaceId, id);
    return this.prisma.memoriaOperativa.update({
      where: { id },
      data: {
        ...(dto.procesoClave !== undefined ? { procesoClave: dto.procesoClave.trim() } : {}),
        ...(dto.hecho !== undefined ? { hecho: dto.hecho.trim() } : {}),
        ...(dto.fuente !== undefined ? { fuente: trimOrNull(dto.fuente) ?? null } : {}),
        ...(dto.estado !== undefined ? { estado: dto.estado } : {}),
        ...(dto.caducaEn !== undefined ? { caducaEn: dto.caducaEn ? new Date(dto.caducaEn) : null } : {}),
      },
    });
  }

  /**
   * Hechos VIGENTES de un proceso (ADR 0018 Inc.3): solo los CONFIRMADO y no caducados (`caducaEn` nulo o futuro). Es
   * el único corte que el agente debe tratar como contexto operativo de confianza; la lista general sigue mostrando
   * todos los hechos con su estado para la revisión humana. Filtra siempre por workspace (multi-tenant).
   */
  listMemoriasVigentes(workspaceId: string, procesoClave?: string) {
    const ahora = new Date();
    return this.prisma.memoriaOperativa.findMany({
      where: {
        workspaceId,
        estado: 'CONFIRMADO',
        ...(procesoClave ? { procesoClave } : {}),
        OR: [{ caducaEn: null }, { caducaEn: { gt: ahora } }],
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Contexto compacto de hechos vigentes por proceso (ADR 0018 Inc.3, punto 5). Queda disponible para un refinamiento
   * posterior que inyecte memoria al runtime del agente; NO se fuerza aquí. Es CONTEXTO: no concede permisos ni altera
   * la versión del agente (ADR 0004). Devuelve solo el hecho y su fuente de los vigentes, en texto apto para prompt.
   */
  async getContextoVigente(
    workspaceId: string,
    procesoClave: string,
  ): Promise<{ hecho: string; fuente: string | null }[]> {
    const vigentes = await this.listMemoriasVigentes(workspaceId, procesoClave);
    return vigentes.map((m) => ({ hecho: m.hecho, fuente: m.fuente }));
  }

  /**
   * Confirmación gobernada (ADR 0018 Inc.3): pasa un hecho de PROPUESTO a CONFIRMADO tras revisión humana (EDITOR+) y lo
   * registra en la auditoría inmutable. NO reescribe prompts ni crea versiones de agente (ADR 0004): es solo un cambio
   * de estado de un dato de contexto. Falla si el hecho ya estaba confirmado (idempotencia explícita por conflicto).
   */
  async confirmarMemoria(workspaceId: string, id: string, actor: AuthContext) {
    const memoria = await this.getMemoria(workspaceId, id);
    if (memoria.estado === 'CONFIRMADO') throw new ConflictException('El hecho ya está confirmado');
    const actualizado = await this.prisma.memoriaOperativa.update({
      where: { id },
      data: { estado: 'CONFIRMADO' },
    });
    await this.audit.append(workspaceId, {
      actorType: actor.userId ? 'USER' : 'SYSTEM',
      actorId: actor.userId ?? null,
      action: AUDIT_ACTIONS.MEMORIA_CONFIRMADA,
      targetType: 'MemoriaOperativa',
      targetId: id,
      resumen: `Hecho de memoria confirmado en el proceso «${memoria.procesoClave}»`,
      metadata: { procesoClave: memoria.procesoClave, estadoAnterior: 'PROPUESTO', estadoNuevo: 'CONFIRMADO' },
    });
    return actualizado;
  }

  /** Descarte gobernado (ADR 0018 Inc.3): elimina un hecho y lo audita. No altera la versión del agente (ADR 0004). */
  async removeMemoria(workspaceId: string, id: string, actor: AuthContext) {
    const memoria = await this.getMemoria(workspaceId, id);
    await this.prisma.memoriaOperativa.delete({ where: { id } });
    await this.audit.append(workspaceId, {
      actorType: actor.userId ? 'USER' : 'SYSTEM',
      actorId: actor.userId ?? null,
      action: AUDIT_ACTIONS.MEMORIA_DESCARTADA,
      targetType: 'MemoriaOperativa',
      targetId: id,
      resumen: `Hecho de memoria descartado del proceso «${memoria.procesoClave}»`,
      metadata: { procesoClave: memoria.procesoClave, estado: memoria.estado },
    });
  }

  /**
   * Purga de caducados (ADR 0018 Inc.3): elimina los hechos cuya `caducaEn` ya venció y audita cada baja con
   * MEMORIA_CADUCADA para dejar traza por hecho. El filtro-en-lectura de `listMemoriasVigentes` ya excluye los
   * caducados; esta purga es la limpieza explícita e invocable (no un cron nuevo). No toca la versión del agente.
   */
  async purgarCaducados(workspaceId: string, actor: AuthContext) {
    const ahora = new Date();
    const caducados = await this.prisma.memoriaOperativa.findMany({
      where: { workspaceId, caducaEn: { not: null, lte: ahora } },
    });
    for (const memoria of caducados) {
      await this.prisma.memoriaOperativa.delete({ where: { id: memoria.id } });
      await this.audit.append(workspaceId, {
        actorType: actor.userId ? 'USER' : 'SYSTEM',
        actorId: actor.userId ?? null,
        action: AUDIT_ACTIONS.MEMORIA_CADUCADA,
        targetType: 'MemoriaOperativa',
        targetId: memoria.id,
        resumen: `Hecho de memoria purgado por caducidad en el proceso «${memoria.procesoClave}»`,
        metadata: {
          procesoClave: memoria.procesoClave,
          estado: memoria.estado,
          caducaEn: memoria.caducaEn?.toISOString(),
        },
      });
    }
    return { purgados: caducados.length };
  }
}
