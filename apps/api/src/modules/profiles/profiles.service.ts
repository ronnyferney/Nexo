import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

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

  async removeMemoria(workspaceId: string, id: string) {
    await this.getMemoria(workspaceId, id);
    await this.prisma.memoriaOperativa.delete({ where: { id } });
  }
}
