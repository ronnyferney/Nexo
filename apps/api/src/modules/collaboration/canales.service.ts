import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ConvertirEnTareaDto, CrearCanalDto, CrearHiloDto } from './dto/canal.dto';

/** Límite de intercambios por hilo antes de escalar (prevención de ciclos/ruido, RF36). Conservador por defecto. */
const MAX_INTERCAMBIOS_HILO = 100;

/**
 * Coordinación transversal (RF36 · núcleo): canales por misión/proceso/área con hilos. Regla central: una solicitud
 * de acción NO ejecuta sola — se convierte en una `Tarea` autorizada solo con autoridad (EDITOR+), nunca por una
 * mención. Mencionar/referenciar no concede acceso (QA12): todo se filtra por `workspaceId`. Prevención de ruido:
 * límite de intercambios por hilo. Estas entidades las reutilizará la Comunidad interna (E11).
 */
@Injectable()
export class CanalesService {
  constructor(private readonly prisma: PrismaService) {}

  listCanales(workspaceId: string) {
    return this.prisma.canal.findMany({
      where: { workspaceId },
      include: { _count: { select: { hilos: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCanal(workspaceId: string, id: string) {
    const canal = await this.prisma.canal.findFirst({
      where: { id, workspaceId },
      include: { hilos: { orderBy: { createdAt: 'desc' } } },
    });
    if (!canal) throw new NotFoundException('Canal no encontrado');
    return canal;
  }

  crearCanal(workspaceId: string, dto: CrearCanalDto) {
    return this.prisma.canal.create({
      data: {
        workspaceId,
        tipo: dto.tipo,
        nombre: dto.nombre.trim(),
        descripcion: dto.descripcion?.trim() || null,
        orgUnitId: dto.orgUnitId ?? null,
        misionId: dto.misionId ?? null,
      },
    });
  }

  async crearHilo(workspaceId: string, canalId: string, dto: CrearHiloDto) {
    await this.getCanal(workspaceId, canalId);
    return this.prisma.hiloCanal.create({
      data: { workspaceId, canalId, asunto: dto.asunto.trim() },
    });
  }

  listHilos(workspaceId: string, canalId: string) {
    return this.prisma.hiloCanal.findMany({ where: { workspaceId, canalId }, orderBy: { createdAt: 'desc' } });
  }

  /** Registra un intercambio en el hilo; al superar el umbral se detiene (prevención de ciclos/ruido, RF36). */
  async registrarIntercambio(workspaceId: string, hiloId: string) {
    const hilo = await this.prisma.hiloCanal.findFirst({ where: { id: hiloId, workspaceId } });
    if (!hilo) throw new NotFoundException('Hilo no encontrado');
    if (hilo.intercambios >= MAX_INTERCAMBIOS_HILO) {
      throw new BadRequestException('El hilo superó el límite de intercambios; escale a decisión humana (RF36)');
    }
    return this.prisma.hiloCanal.update({ where: { id: hiloId }, data: { intercambios: { increment: 1 } } });
  }

  /**
   * Convierte una solicitud del hilo en una TAREA autorizada (D5). Idempotente: si el hilo ya se convirtió, devuelve
   * la tarea existente (no crea otra). Requiere autoridad (EDITOR+, en el controlador): una mención no asigna trabajo.
   */
  async convertirEnTarea(workspaceId: string, hiloId: string, dto: ConvertirEnTareaDto) {
    const hilo = await this.prisma.hiloCanal.findFirst({ where: { id: hiloId, workspaceId } });
    if (!hilo) throw new NotFoundException('Hilo no encontrado');
    if (hilo.tareaId) {
      const existente = await this.prisma.tarea.findFirst({ where: { id: hilo.tareaId, workspaceId } });
      if (existente) return existente;
    }
    if (dto.objetivoId) {
      const obj = await this.prisma.objetivo.findFirst({
        where: { id: dto.objetivoId, workspaceId },
        select: { id: true },
      });
      if (!obj) throw new BadRequestException('El objetivo indicado no existe en este workspace');
    }
    return this.prisma.$transaction(async (tx) => {
      const tarea = await tx.tarea.create({
        data: {
          workspaceId,
          titulo: dto.titulo.trim(),
          criterioAceptacion: dto.criterioAceptacion?.trim() || null,
          responsableAgentId: dto.responsableAgentId ?? null,
          duenoUserId: dto.duenoUserId ?? null,
          objetivoId: dto.objetivoId ?? null,
        },
      });
      await tx.hiloCanal.update({ where: { id: hiloId }, data: { tareaId: tarea.id } });
      return tarea;
    });
  }
}
