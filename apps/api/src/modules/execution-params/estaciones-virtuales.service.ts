import { Injectable, NotFoundException } from '@nestjs/common';
import type { EstacionVirtual } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import type { CreateEstacionVirtualDto, UpdateEstacionVirtualDto } from './dto/estacion-virtual.dto';

/**
 * Estaciones virtuales (E8): recurso del workspace que representa la máquina (real o lógica) asignable a un empleado
 * digital. Capa de CONFIGURACIÓN gobernada; el aprovisionamiento real de la VM y el runtime RPA llegan en un incremento
 * posterior (TODO E8-2). NUNCA se guardan credenciales ni secretos: `proveedor` es solo una etiqueta. Todo filtra por
 * `workspaceId` (multi-tenant). Crear, editar y retirar una estación quedan auditados (E13).
 */
@Injectable()
export class EstacionesVirtualesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(workspaceId: string) {
    const estaciones = await this.prisma.estacionVirtual.findMany({
      where: { workspaceId },
      include: { _count: { select: { agentes: true } } },
      orderBy: [{ estado: 'asc' }, { nombre: 'asc' }],
    });
    return estaciones.map(({ _count, ...e }) => ({ ...e, agentesCount: _count.agentes }));
  }

  async get(workspaceId: string, id: string) {
    const estacion = await this.prisma.estacionVirtual.findFirst({
      where: { id, workspaceId },
      include: { _count: { select: { agentes: true } } },
    });
    if (!estacion) throw new NotFoundException('Estación virtual no encontrada');
    const { _count, ...rest } = estacion;
    return { ...rest, agentesCount: _count.agentes };
  }

  /** Garantiza que la estación pertenece al workspace (usado al asignarla a un agente). */
  async assertInWorkspace(workspaceId: string, id: string): Promise<EstacionVirtual> {
    const estacion = await this.prisma.estacionVirtual.findFirst({ where: { id, workspaceId } });
    if (!estacion) throw new NotFoundException('Estación virtual no encontrada');
    return estacion;
  }

  async create(auth: AuthContext, dto: CreateEstacionVirtualDto) {
    const { workspaceId } = auth;
    const estacion = await this.prisma.estacionVirtual.create({
      data: {
        workspaceId,
        nombre: dto.nombre.trim(),
        descripcion: dto.descripcion?.trim() || null,
        proveedor: dto.proveedor?.trim() || null,
      },
    });

    await this.audit.append(workspaceId, {
      actorType: auth.userId ? 'USER' : 'SYSTEM',
      actorId: auth.userId ?? null,
      action: AUDIT_ACTIONS.ESTACION_VIRTUAL_CREADA,
      targetType: 'EstacionVirtual',
      targetId: estacion.id,
      resumen: `Estación virtual creada: ${estacion.nombre}`,
      metadata: { nombre: estacion.nombre, proveedor: estacion.proveedor },
    });

    return this.get(workspaceId, estacion.id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateEstacionVirtualDto) {
    const { workspaceId } = auth;
    const previa = await this.assertInWorkspace(workspaceId, id);
    const estadoNuevo = dto.estado ?? previa.estado;
    await this.prisma.estacionVirtual.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
        ...(dto.descripcion !== undefined ? { descripcion: dto.descripcion?.trim() || null } : {}),
        ...(dto.proveedor !== undefined ? { proveedor: dto.proveedor?.trim() || null } : {}),
        ...(dto.estado !== undefined ? { estado: dto.estado } : {}),
      },
    });

    const esRetiro = dto.estado === 'RETIRADA' && previa.estado !== 'RETIRADA';
    await this.audit.append(workspaceId, {
      actorType: auth.userId ? 'USER' : 'SYSTEM',
      actorId: auth.userId ?? null,
      action: esRetiro ? AUDIT_ACTIONS.ESTACION_VIRTUAL_RETIRADA : AUDIT_ACTIONS.ESTACION_VIRTUAL_MODIFICADA,
      targetType: 'EstacionVirtual',
      targetId: id,
      resumen: esRetiro
        ? `Estación virtual retirada: ${previa.nombre}`
        : `Estación virtual modificada: ${dto.nombre?.trim() ?? previa.nombre}`,
      metadata: { estadoPrevio: previa.estado, estadoNuevo },
    });

    return this.get(workspaceId, id);
  }

  /**
   * Baja lógica: la estación pasa a `RETIRADA` (no se borra). Los agentes asignados CONSERVAN el vínculo histórico
   * (`estacionVirtualId` intacto): retirar no desasigna ni rompe ningún agente. Un agente en una estación retirada no
   * debería recibir trabajo nuevo que requiera máquina (lo valida el runtime del incremento posterior, TODO E8-2).
   */
  async retirar(auth: AuthContext, id: string) {
    const { workspaceId } = auth;
    const previa = await this.assertInWorkspace(workspaceId, id);
    if (previa.estado !== 'RETIRADA') {
      await this.prisma.estacionVirtual.update({ where: { id }, data: { estado: 'RETIRADA' } });
      await this.audit.append(workspaceId, {
        actorType: auth.userId ? 'USER' : 'SYSTEM',
        actorId: auth.userId ?? null,
        action: AUDIT_ACTIONS.ESTACION_VIRTUAL_RETIRADA,
        targetType: 'EstacionVirtual',
        targetId: id,
        resumen: `Estación virtual retirada: ${previa.nombre}`,
        metadata: { estadoPrevio: previa.estado, estadoNuevo: 'RETIRADA' },
      });
    }
    return this.get(workspaceId, id);
  }
}
