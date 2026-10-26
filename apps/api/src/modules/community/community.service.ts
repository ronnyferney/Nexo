import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { ROLE_RANK } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  ActualizarPublicacionDto,
  CrearComentarioDto,
  CrearPublicacionDto,
  CrearReaccionDto,
  ListarPublicacionesQueryDto,
} from './dto/publicacion.dto';

const TAKE_POR_DEFECTO = 20;

/**
 * Comunidad interna (E11): el "muro" corporativo privado. Red social interna para comunicar novedades, pedir apoyo,
 * compartir aprendizajes y coordinar compromisos. No es un chat suelto: un COMPROMISO/APOYO puede ligarse a una Tarea
 * (referencia blanda, validada aquí) para contribuir a los procesos. Multi-tenant estricto: todo filtra por
 * `workspaceId`; un workspace no ve ni comenta publicaciones de otro (404). El autor SIEMPRE es el usuario autenticado.
 * El contenido es texto de usuario: NO se expande con el motor de plantillas ni se ejecuta (nada de `eval`).
 *
 * No se audita (E13): el muro es contenido social de alto volumen; auditarlo no aporta valor claro y encarece la
 * cadena encadenada por workspace. Los hechos gobernados (tareas, aprobaciones) ya se auditan en sus módulos.
 */
@Injectable()
export class CommunityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Exige un usuario humano autenticado (no una API key máquina-a-máquina): el autor del muro es siempre una persona. */
  private requireUser(auth: AuthContext): string {
    if (!auth.userId) {
      throw new ForbiddenException('Publicar en la comunidad requiere un usuario autenticado');
    }
    return auth.userId;
  }

  private esAdmin(auth: AuthContext): boolean {
    return ROLE_RANK[auth.role] >= ROLE_RANK.ADMIN;
  }

  private async tareaDelWorkspace(workspaceId: string, tareaId: string): Promise<void> {
    const tarea = await this.prisma.tarea.findFirst({ where: { id: tareaId, workspaceId }, select: { id: true } });
    if (!tarea) throw new BadRequestException('La tarea indicada no existe en este workspace');
  }

  /** Feed del muro: recientes primero, con autor, nº de comentarios y nº de reacciones. Oculta ARCHIVADA salvo filtro. */
  async listPublicaciones(workspaceId: string, q: ListarPublicacionesQueryDto) {
    const take = q.take ?? TAKE_POR_DEFECTO;
    const skip = q.skip ?? 0;
    const where = {
      workspaceId,
      ...(q.tipo ? { tipo: q.tipo } : {}),
      ...(q.orgUnitId ? { orgUnitId: q.orgUnitId } : {}),
      // Sin filtro de estado, el muro muestra lo vigente (ACTIVA/RESUELTA) y oculta la baja lógica (ARCHIVADA).
      ...(q.estado ? { estado: q.estado } : { estado: { not: 'ARCHIVADA' as const } }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.publicacion.findMany({
        where,
        include: { _count: { select: { comentarios: true, reacciones: true } } },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.publicacion.count({ where }),
    ]);
    return { items, total, take, skip };
  }

  async crearPublicacion(workspaceId: string, auth: AuthContext, dto: CrearPublicacionDto) {
    const autorUserId = this.requireUser(auth);
    if (dto.tareaId) {
      if (dto.tipo !== 'COMPROMISO' && dto.tipo !== 'APOYO') {
        throw new BadRequestException('Solo un COMPROMISO o un APOYO puede ligarse a una tarea');
      }
      await this.tareaDelWorkspace(workspaceId, dto.tareaId);
    }
    return this.prisma.publicacion.create({
      data: {
        workspaceId,
        autorUserId,
        tipo: dto.tipo,
        titulo: dto.titulo?.trim() || null,
        cuerpo: dto.cuerpo.trim(),
        orgUnitId: dto.orgUnitId ?? null,
        tareaId: dto.tareaId ?? null,
      },
    });
  }

  async getPublicacion(workspaceId: string, id: string) {
    const publicacion = await this.prisma.publicacion.findFirst({
      where: { id, workspaceId },
      include: {
        comentarios: { orderBy: { createdAt: 'asc' } },
        _count: { select: { comentarios: true, reacciones: true } },
      },
    });
    if (!publicacion) throw new NotFoundException('Publicación no encontrada');
    return publicacion;
  }

  /** Solo el autor o un ADMIN+ edita. Permite ajustar texto y cambiar estado (p. ej. marcar un APOYO como RESUELTA). */
  async actualizarPublicacion(workspaceId: string, id: string, auth: AuthContext, dto: ActualizarPublicacionDto) {
    const userId = this.requireUser(auth);
    const publicacion = await this.prisma.publicacion.findFirst({ where: { id, workspaceId } });
    if (!publicacion) throw new NotFoundException('Publicación no encontrada');
    if (publicacion.autorUserId !== userId && !this.esAdmin(auth)) {
      throw new ForbiddenException('Solo el autor o un administrador puede modificar esta publicación');
    }
    return this.prisma.publicacion.update({
      where: { id },
      data: {
        ...(dto.titulo !== undefined ? { titulo: dto.titulo.trim() || null } : {}),
        ...(dto.cuerpo !== undefined ? { cuerpo: dto.cuerpo.trim() } : {}),
        ...(dto.estado !== undefined ? { estado: dto.estado } : {}),
      },
    });
  }

  /** Baja lógica: marca ARCHIVADA (conserva histórico, comentarios y reacciones; sale del muro). Autor o ADMIN+. */
  async eliminarPublicacion(workspaceId: string, id: string, auth: AuthContext) {
    const userId = this.requireUser(auth);
    const publicacion = await this.prisma.publicacion.findFirst({ where: { id, workspaceId } });
    if (!publicacion) throw new NotFoundException('Publicación no encontrada');
    if (publicacion.autorUserId !== userId && !this.esAdmin(auth)) {
      throw new ForbiddenException('Solo el autor o un administrador puede archivar esta publicación');
    }
    return this.prisma.publicacion.update({ where: { id }, data: { estado: 'ARCHIVADA' } });
  }

  async listComentarios(workspaceId: string, publicacionId: string) {
    await this.getPublicacion(workspaceId, publicacionId);
    return this.prisma.comentario.findMany({
      where: { workspaceId, publicacionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async comentar(workspaceId: string, publicacionId: string, auth: AuthContext, dto: CrearComentarioDto) {
    const autorUserId = this.requireUser(auth);
    await this.getPublicacion(workspaceId, publicacionId);
    return this.prisma.comentario.create({
      data: { workspaceId, publicacionId, autorUserId, cuerpo: dto.cuerpo.trim() },
    });
  }

  /** Reacción idempotente: una por (publicación, autor, tipo). Repetir devuelve la existente, no crea otra ni falla. */
  async reaccionar(workspaceId: string, publicacionId: string, auth: AuthContext, dto: CrearReaccionDto) {
    const autorUserId = this.requireUser(auth);
    await this.getPublicacion(workspaceId, publicacionId);
    const existente = await this.prisma.reaccion.findFirst({
      where: { publicacionId, autorUserId, tipo: dto.tipo },
    });
    if (existente) return existente;
    return this.prisma.reaccion.create({
      data: { workspaceId, publicacionId, autorUserId, tipo: dto.tipo },
    });
  }

  /** Retira la reacción del usuario (idempotente: si no existía, no falla). */
  async quitarReaccion(workspaceId: string, publicacionId: string, auth: AuthContext, tipo: string) {
    const autorUserId = this.requireUser(auth);
    await this.getPublicacion(workspaceId, publicacionId);
    await this.prisma.reaccion.deleteMany({ where: { workspaceId, publicacionId, autorUserId, tipo } });
    return { ok: true };
  }
}
