import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Datos para enriquecer perfiles a partir de un correo entrante. El `workspaceId` lo fija el canal, nunca el cuerpo. */
export interface EnrichFromEmailInput {
  workspaceId: string;
  /** Dirección del remitente (se normaliza a minúsculas). */
  email: string;
  /** Nombre para mostrar del remitente, si el canal lo aporta. */
  nombre?: string;
  /** Dominio corporativo; si se omite, se deriva de la parte derecha del correo. */
  dominio?: string;
  /** Procedencia del dato; por defecto `correo`. */
  fuente?: string;
}

/** Resultado del enriquecimiento (ids resueltos para que el llamador pueda usarlos como contexto). */
export interface EnrichResult {
  contactoId: string;
  organizacionId: string | null;
}

/**
 * Dominios de correo personales comunes: no modelan una organización, así que NO se crea `OrganizacionPerfil` para
 * ellos (ADR 0018 Inc.2: «omite dominios de correo personales comunes»). Lista corta y pragmática, ampliable.
 */
const DOMINIOS_PERSONALES = new Set<string>([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.es',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'gmx.com',
  'zoho.com',
]);

/** Extrae y normaliza el dominio de un correo (parte a la derecha de la última `@`). `null` si no es un correo válido. */
function dominioDeCorreo(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return (
    email
      .slice(at + 1)
      .trim()
      .toLowerCase() || null
  );
}

/** Nombre por defecto a partir del correo (parte local) cuando el canal no aporta uno. */
function nombrePorDefecto(email: string): string {
  const at = email.indexOf('@');
  const local = at > 0 ? email.slice(0, at) : email;
  return local.trim() || email;
}

/**
 * Enriquecimiento de perfiles desde el correo entrante (ADR 0018 Inc.2). Reutiliza el modelo de Inc.1 para crear/
 * actualizar de forma IDEMPOTENTE el perfil de la persona (por `correoPrincipal`) y el de su organización (por
 * `dominio`). Multi-tenant estricto: el `workspaceId` lo fija el canal (nunca el cuerpo de la petición). Los perfiles
 * son CONTEXTO, no conceden permisos y no admiten secretos. Reprocesar el mismo correo NO duplica el contacto
 * (respeta la unicidad `(workspaceId, correoPrincipal)` de Inc.1); solo acumula la interacción.
 */
@Injectable()
export class ProfilesEnrichmentService {
  private readonly logger = new Logger(ProfilesEnrichmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert idempotente de organización (si procede) y contacto a partir de un correo entrante. Nunca lanza por datos
   * inválidos de un entrante no confiable: si el correo no es procesable, lo registra y devuelve `null`.
   */
  async enrichFromEmail(input: EnrichFromEmailInput): Promise<EnrichResult | null> {
    const email = input.email.trim().toLowerCase();
    if (!email || email.indexOf('@') <= 0) {
      this.logger.debug(
        `Correo entrante sin dirección procesable; se omite el enriquecimiento (ws=${input.workspaceId})`,
      );
      return null;
    }
    const fuente = input.fuente?.trim() || 'correo';
    const dominio = (input.dominio?.trim().toLowerCase() || dominioDeCorreo(email)) ?? null;

    const organizacionId = await this.upsertOrganizacion(input.workspaceId, dominio, fuente);
    const contactoId = await this.upsertContacto(input.workspaceId, email, input.nombre, organizacionId, fuente);
    return { contactoId, organizacionId };
  }

  /**
   * Upsert de `OrganizacionPerfil` por `(workspaceId, dominio)`. Omite dominios personales comunes. Devuelve el id de
   * la organización vinculable o `null`. Idempotente: no duplica ante reprocesos ni carreras (reintenta por P2002).
   */
  private async upsertOrganizacion(
    workspaceId: string,
    dominio: string | null,
    fuente: string,
  ): Promise<string | null> {
    if (!dominio || DOMINIOS_PERSONALES.has(dominio)) return null;
    try {
      const org = await this.prisma.organizacionPerfil.upsert({
        where: { workspaceId_dominio: { workspaceId, dominio } },
        // No se pisa el nombre existente: el dominio es la clave estable; el nombre inicial deriva del dominio.
        update: {},
        create: { workspaceId, nombre: dominio, dominio, fuente },
        select: { id: true },
      });
      return org.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const org = await this.prisma.organizacionPerfil.findUnique({
          where: { workspaceId_dominio: { workspaceId, dominio } },
          select: { id: true },
        });
        return org?.id ?? null;
      }
      throw err;
    }
  }

  /**
   * Upsert de `ContactoPerfil` por `(workspaceId, correoPrincipal)`. Si existe: completa el nombre solo si estaba
   * derivado/vacío, vincula la organización si aún no la tenía, agrega el correo a `correos`, marca la última
   * interacción e incrementa el contador. Si no existe: lo crea con `fuente`. Idempotente ante reprocesos/carreras.
   */
  private async upsertContacto(
    workspaceId: string,
    correo: string,
    nombre: string | undefined,
    organizacionId: string | null,
    fuente: string,
  ): Promise<string> {
    const ahora = new Date();
    const nombreEntrante = nombre?.trim();

    const existente = await this.prisma.contactoPerfil.findUnique({
      where: { workspaceId_correoPrincipal: { workspaceId, correoPrincipal: correo } },
      select: { id: true, nombre: true, organizacionId: true, correos: true },
    });

    if (existente) {
      const correos = this.mergeCorreos(existente.correos, correo);
      // El nombre solo se completa si el actual estaba vacío o era el derivado del correo (no pisa ediciones humanas).
      const nombreEsDerivado = existente.nombre.trim() === nombrePorDefecto(correo);
      const data: Prisma.ContactoPerfilUpdateInput = {
        correos,
        ultimaInteraccionEn: ahora,
        interaccionesCount: { increment: 1 },
      };
      if (nombreEntrante && (existente.nombre.trim().length === 0 || nombreEsDerivado)) {
        data.nombre = nombreEntrante;
      }
      if (!existente.organizacionId && organizacionId) {
        data.organizacion = { connect: { id: organizacionId } };
      }
      await this.prisma.contactoPerfil.update({ where: { id: existente.id }, data });
      return existente.id;
    }

    try {
      const creado = await this.prisma.contactoPerfil.create({
        data: {
          workspaceId,
          nombre: nombreEntrante || nombrePorDefecto(correo),
          correoPrincipal: correo,
          correos: [correo],
          organizacionId,
          fuente,
          ultimaInteraccionEn: ahora,
          interaccionesCount: 1,
        },
        select: { id: true },
      });
      return creado.id;
    } catch (err) {
      // Carrera: otro entrante concurrente creó el contacto. Reintenta como actualización (idempotencia).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const ganador = await this.prisma.contactoPerfil.findUniqueOrThrow({
          where: { workspaceId_correoPrincipal: { workspaceId, correoPrincipal: correo } },
          select: { id: true },
        });
        await this.prisma.contactoPerfil.update({
          where: { id: ganador.id },
          data: { ultimaInteraccionEn: ahora, interaccionesCount: { increment: 1 } },
        });
        return ganador.id;
      }
      throw err;
    }
  }

  /** Normaliza la lista `correos` (JSON) y añade el correo entrante sin duplicar. */
  private mergeCorreos(actuales: Prisma.JsonValue, correo: string): string[] {
    const lista = Array.isArray(actuales) ? actuales.filter((v): v is string => typeof v === 'string') : [];
    const set = new Set(lista.map((c) => c.toLowerCase()));
    set.add(correo);
    return [...set];
  }
}
