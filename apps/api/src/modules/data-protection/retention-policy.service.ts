import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoliticaRetencion } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import type { UpsertRetentionPolicyDto } from './dto/retention-policy.dto';
import {
  resolverRetencion,
  type AlcanceConsulta,
  type PoliticaRetencionPlana,
  type RetencionResuelta,
} from './retention-policy.resolver';

/** Banderas auditables de una política (lo que Jurídica debe poder comparar antes/después de un cambio). */
type PoliticaBanderas = Pick<
  PoliticaRetencion,
  'canal' | 'tipoInformacion' | 'retencionDias' | 'eliminacionSegura' | 'consentimientoRequerido'
>;

/**
 * Políticas de retención/privacidad diferenciadas por organización (workspace), canal y tipo de información (P0.2 ·
 * decisión Jurídica). Extiende de forma ADITIVA la retención por workspace (`PrivacySettings`): la política más
 * específica aplicable gana; si no hay ninguna, rige la del workspace (180 d por defecto). CRUD gobernado: solo ADMIN+
 * (en el controlador) y cada cambio queda en la auditoría inmutable (E13) con los valores anterior/nuevo.
 *
 * Multi-tenant estricto: `workspaceId` siempre de `@CurrentAuth()`. La unicidad por alcance (una fila por combinación
 * `canal`+`tipoInformacion`) la garantiza este servicio: Postgres trata los NULL como distintos en índices únicos, así
 * que el upsert busca la fila exacta (incluyendo los comodines null) antes de crear.
 */
@Injectable()
export class RetentionPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Políticas del workspace, ordenadas de la más específica a la más general (determinista). */
  async list(workspaceId: string): Promise<PoliticaRetencion[]> {
    return this.prisma.politicaRetencion.findMany({
      where: { workspaceId },
      orderBy: [{ canal: 'asc' }, { tipoInformacion: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Upsert por alcance: crea o actualiza la política de `(canal, tipoInformacion)`. Audita el cambio (anterior/nuevo). */
  async upsert(a: AuthContext, dto: UpsertRetentionPolicyDto): Promise<PoliticaRetencion> {
    const canal = dto.canal ?? null;
    const tipoInformacion = dto.tipoInformacion ?? null;
    const previa = await this.prisma.politicaRetencion.findFirst({
      where: { workspaceId: a.workspaceId, canal, tipoInformacion },
    });

    const data = {
      retencionDias: dto.retencionDias === undefined ? (previa?.retencionDias ?? null) : dto.retencionDias,
      eliminacionSegura: dto.eliminacionSegura ?? previa?.eliminacionSegura ?? false,
      consentimientoRequerido: dto.consentimientoRequerido ?? previa?.consentimientoRequerido ?? false,
    };

    const guardada = previa
      ? await this.prisma.politicaRetencion.update({ where: { id: previa.id }, data })
      : await this.prisma.politicaRetencion.create({
          data: { workspaceId: a.workspaceId, canal, tipoInformacion, ...data },
        });

    await this.audit.append(a.workspaceId, {
      actorType: 'USER',
      actorId: a.userId ?? null,
      action: AUDIT_ACTIONS.POLITICA_RETENCION_MODIFICADA,
      targetType: 'PoliticaRetencion',
      targetId: guardada.id,
      resumen: `Política de retención ${alcanceTexto(canal, tipoInformacion)} actualizada`,
      metadata: {
        alcance: { canal, tipoInformacion },
        anterior: previa ? this.banderas(previa) : null,
        nuevo: this.banderas(guardada),
      },
    });

    return guardada;
  }

  /** Elimina una política del workspace (vuelve a la resolución por workspace para su alcance). Audita el hecho. */
  async remove(a: AuthContext, id: string): Promise<void> {
    const politica = await this.prisma.politicaRetencion.findFirst({ where: { id, workspaceId: a.workspaceId } });
    if (!politica) throw new NotFoundException('Política de retención no encontrada');

    await this.prisma.politicaRetencion.delete({ where: { id: politica.id } });
    await this.audit.append(a.workspaceId, {
      actorType: 'USER',
      actorId: a.userId ?? null,
      action: AUDIT_ACTIONS.POLITICA_RETENCION_ELIMINADA,
      targetType: 'PoliticaRetencion',
      targetId: politica.id,
      resumen: `Política de retención ${alcanceTexto(politica.canal, politica.tipoInformacion)} eliminada`,
      metadata: {
        alcance: { canal: politica.canal, tipoInformacion: politica.tipoInformacion },
        anterior: this.banderas(politica),
      },
    });
  }

  /** Políticas planas de un workspace para el resolutor (sin ids ni tiempos). */
  async planasDe(workspaceId: string): Promise<PoliticaRetencionPlana[]> {
    return (await this.list(workspaceId)).map((p) => this.plana(p));
  }

  /** Políticas planas de TODOS los workspaces con alguna política (purga diaria). Lanza si el almacén no responde. */
  async planasPorWorkspace(): Promise<Map<string, PoliticaRetencionPlana[]>> {
    const rows = await this.prisma.politicaRetencion.findMany();
    const out = new Map<string, PoliticaRetencionPlana[]>();
    for (const row of rows) {
      const lista = out.get(row.workspaceId) ?? [];
      lista.push(this.plana(row));
      out.set(row.workspaceId, lista);
    }
    return out;
  }

  /** Resuelve la política vigente de un alcance combinando las del workspace con la retención del workspace. */
  async resolver(
    workspaceId: string,
    workspaceRetencionDias: number | null,
    alcance: AlcanceConsulta,
  ): Promise<RetencionResuelta> {
    return resolverRetencion(await this.planasDe(workspaceId), workspaceRetencionDias, alcance);
  }

  // ---------- Internos ----------
  private plana(p: PoliticaRetencion): PoliticaRetencionPlana {
    return {
      canal: p.canal,
      tipoInformacion: p.tipoInformacion,
      retencionDias: p.retencionDias,
      eliminacionSegura: p.eliminacionSegura,
      consentimientoRequerido: p.consentimientoRequerido,
    };
  }

  private banderas(p: PoliticaRetencion): PoliticaBanderas {
    return {
      canal: p.canal,
      tipoInformacion: p.tipoInformacion,
      retencionDias: p.retencionDias,
      eliminacionSegura: p.eliminacionSegura,
      consentimientoRequerido: p.consentimientoRequerido,
    };
  }
}

/** Texto legible del alcance para los resúmenes de auditoría (sin contenido sensible). */
function alcanceTexto(canal: string | null, tipoInformacion: string | null): string {
  return `(canal: ${canal ?? 'todos'}, tipo: ${tipoInformacion ?? 'todos'})`;
}
