import { Injectable } from '@nestjs/common';
import type { GrabacionConfig } from '@prisma/client';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../../audit/audit.service';
import { AUDIT_ACTIONS } from '../../../audit/audit.types';
import type { AuthContext } from '../../../../common/decorators/current-user.decorator';
import type { PutGrabacionConfigDto } from './dto/grabacion-config.dto';
import {
  evaluarRetencion,
  GRABACION_OFF,
  type EvaluacionRetencion,
  type GrabacionFlags,
  type TipoDatoGrabacion,
} from './grabacion-config.evaluacion';

/** Banderas auditables de la configuración (lo que Jurídica debe poder comparar antes/después de un cambio). */
type GrabacionBanderas = GrabacionFlags & {
  requiereAutorizacion: boolean;
  finalidad: string | null;
  accesoRoles: string[];
};

/**
 * Controles configurables de grabación y retención por empresa (ADR 0015 D3/D4 · decisión Jurídica D7). TODO OFF/null
 * por defecto: sin configuración explícita, NADA se graba ni se retiene. El servicio NO ejecuta borrados productivos ni
 * declara plazos legales/valor probatorio; solo expone y persiste controles técnicos.
 *
 * Multi-tenant estricto: `workspaceId` siempre de `@CurrentAuth()`. Cambiar la configuración es un hecho sensible y se
 * registra en la auditoría inmutable (E13) con las banderas anterior/nuevo.
 *
 * Puntos de verificación para el dominio de voz: `puedeGrabar`, `puedeGuardarTranscripcion`, `puedeGuardar` y
 * `evaluarRetencionEmpresa`. Son la vía autorizada para decidir qué se persiste; voz NUNCA guarda contenido crudo sin
 * pasar por aquí.
 */
@Injectable()
export class GrabacionConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Devuelve la configuración de la empresa o una vista OFF por defecto (no persistida) si no está configurada. */
  async get(workspaceId: string, empresaId: string): Promise<GrabacionConfig | GrabacionConfigDefault> {
    const existente = await this.prisma.grabacionConfig.findUnique({
      where: { workspaceId_empresaId: { workspaceId, empresaId } },
    });
    return existente ?? this.vistaPorDefecto(workspaceId, empresaId);
  }

  /** Upsert de la configuración + auditoría del cambio de banderas (anterior/nuevo). Solo ADMIN+ (en el controlador). */
  async upsert(a: AuthContext, empresaId: string, dto: PutGrabacionConfigDto): Promise<GrabacionConfig> {
    const previa = await this.prisma.grabacionConfig.findUnique({
      where: { workspaceId_empresaId: { workspaceId: a.workspaceId, empresaId } },
    });

    // `retencionDias`: `undefined` (omitido) conserva el valor previo; `null` explícito lo deja "pendiente de política".
    const retencionDias = dto.retencionDias === undefined ? (previa?.retencionDias ?? null) : dto.retencionDias;

    const data = {
      grabarAudio: dto.grabarAudio ?? previa?.grabarAudio ?? false,
      guardarTranscripcion: dto.guardarTranscripcion ?? previa?.guardarTranscripcion ?? false,
      guardarResumen: dto.guardarResumen ?? previa?.guardarResumen ?? false,
      guardarEvidencia: dto.guardarEvidencia ?? previa?.guardarEvidencia ?? false,
      requiereAutorizacion: dto.requiereAutorizacion ?? previa?.requiereAutorizacion ?? true,
      finalidad: dto.finalidad ?? previa?.finalidad ?? null,
      retencionDias,
      accesoRoles: dto.accesoRoles ?? previa?.accesoRoles ?? [],
      eliminacionAutomatica: dto.eliminacionAutomatica ?? previa?.eliminacionAutomatica ?? false,
    };

    const guardada = await this.prisma.grabacionConfig.upsert({
      where: { workspaceId_empresaId: { workspaceId: a.workspaceId, empresaId } },
      create: { workspaceId: a.workspaceId, empresaId, ...data },
      update: data,
    });

    await this.audit.append(a.workspaceId, {
      actorType: 'USER',
      actorId: a.userId ?? null,
      action: AUDIT_ACTIONS.GRABACION_CONFIG_MODIFICADA,
      targetType: 'GrabacionConfig',
      targetId: guardada.id,
      resumen: `Configuración de grabación de la empresa ${empresaId} actualizada`,
      metadata: {
        empresaId,
        anterior: previa ? this.banderas(previa) : null,
        nuevo: this.banderas(guardada),
      },
    });

    return guardada;
  }

  /** Punto de verificación: ¿puede el dominio de voz marcar/persistir audio de esta empresa? */
  async puedeGrabar(workspaceId: string, empresaId: string): Promise<boolean> {
    return this.puedeGuardar(workspaceId, empresaId, 'AUDIO');
  }

  /** Punto de verificación: ¿puede persistirse la transcripción de esta empresa? */
  async puedeGuardarTranscripcion(workspaceId: string, empresaId: string): Promise<boolean> {
    return this.puedeGuardar(workspaceId, empresaId, 'TRANSCRIPCION');
  }

  /** Punto de verificación genérico por tipo de dato. Sin configuración ⇒ OFF. */
  async puedeGuardar(workspaceId: string, empresaId: string, tipoDato: TipoDatoGrabacion): Promise<boolean> {
    return (await this.evaluarRetencionEmpresa(workspaceId, empresaId, tipoDato)).permitido;
  }

  /** Evalúa la retención de un tipo de dato para una empresa (lee la config y aplica la regla PURA). */
  async evaluarRetencionEmpresa(
    workspaceId: string,
    empresaId: string,
    tipoDato: TipoDatoGrabacion,
  ): Promise<EvaluacionRetencion> {
    const config = await this.prisma.grabacionConfig.findUnique({
      where: { workspaceId_empresaId: { workspaceId, empresaId } },
    });
    return evaluarRetencion(config ? this.flags(config) : GRABACION_OFF, tipoDato);
  }

  // ---------- Internos ----------
  private flags(c: GrabacionConfig): GrabacionFlags {
    return {
      grabarAudio: c.grabarAudio,
      guardarTranscripcion: c.guardarTranscripcion,
      guardarResumen: c.guardarResumen,
      guardarEvidencia: c.guardarEvidencia,
      retencionDias: c.retencionDias,
      eliminacionAutomatica: c.eliminacionAutomatica,
    };
  }

  private banderas(c: GrabacionConfig): GrabacionBanderas {
    return {
      ...this.flags(c),
      requiereAutorizacion: c.requiereAutorizacion,
      finalidad: c.finalidad,
      accesoRoles: c.accesoRoles,
    };
  }

  /** Vista OFF por defecto (no persistida) para una empresa sin configuración explícita. */
  private vistaPorDefecto(workspaceId: string, empresaId: string): GrabacionConfigDefault {
    return {
      id: null,
      workspaceId,
      empresaId,
      ...GRABACION_OFF,
      requiereAutorizacion: true,
      finalidad: null,
      accesoRoles: [],
      configurado: false,
    };
  }
}

/** Vista OFF por defecto devuelta cuando la empresa aún no tiene `GrabacionConfig` (nada persistido). */
export interface GrabacionConfigDefault extends GrabacionFlags {
  id: null;
  workspaceId: string;
  empresaId: string;
  requiereAutorizacion: boolean;
  finalidad: string | null;
  accesoRoles: string[];
  /** false = no hay fila persistida; rigen los valores OFF/null por defecto. */
  configurado: false;
}
