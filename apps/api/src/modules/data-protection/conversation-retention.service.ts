import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PrivacySettingsService } from './privacy-settings.service';
import { resolverRetencion, type PoliticaRetencionPlana } from './retention-policy.resolver';
import { RetentionPolicyService } from './retention-policy.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Alcance con el que se purgan las conversaciones ordinarias: son conversaciones de chat con agentes/Copilot
 * (canal CHAT) de información ORDINARIA. La política diferenciada más específica aplicable a este alcance (o, si no hay,
 * la retención del workspace, 180 d por defecto) decide el plazo.
 */
const ALCANCE_CONVERSACIONES = { canal: 'CHAT', tipoInformacion: 'ORDINARIA' } as const;

export interface ConversationPurgeResult {
  /** Conversaciones con agentes (historial nativo incluido). */
  conversations: number;
  /** Sesiones del Copilot (sus mensajes, propuestas y calificaciones se borran en cascada). */
  copilotSessions: number;
  /** Calificaciones de respuestas (`MessageFeedback`), que copian el mensaje y la respuesta. */
  feedback: number;
  /** Workspaces a los que se aplicó una retención. */
  workspaces: number;
  /** La purga se omitió porque no se pudieron leer los ajustes (no se borra con una política desconocida). */
  skipped?: boolean;
}

/**
 * Retención de conversaciones (ADR 0008 D7 · P0.2): borra las conversaciones y los mensajes sin actividad durante más de
 * los días RESUELTOS por workspace. La resolución es aditiva: la política de retención diferenciada (`PoliticaRetencion`)
 * más específica aplicable al alcance CHAT/ORDINARIA gana; si no hay ninguna, rige la retención del workspace
 * (`conversationRetentionDays`), con 180 d por defecto de plataforma. Se ejecuta en el job diario de retención de la cola
 * de flujos (`RetentionService`). Solo registra conteos, nunca contenido.
 */
@Injectable()
export class ConversationRetentionService {
  private readonly logger = new Logger(ConversationRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PrivacySettingsService,
    private readonly policies: RetentionPolicyService,
  ) {}

  /** `workspaceId` acota la purga a un workspace (pruebas y soporte); el job diario recorre todos. */
  async purge(now = new Date(), workspaceId?: string): Promise<ConversationPurgeResult> {
    const result: ConversationPurgeResult = { conversations: 0, copilotSessions: 0, feedback: 0, workspaces: 0 };
    let stored: Map<string, { conversationRetentionDays: number | null }>;
    let policiesByWs: Map<string, PoliticaRetencionPlana[]>;
    try {
      [stored, policiesByWs] = await Promise.all([this.settings.all(), this.policies.planasPorWorkspace()]);
    } catch (err) {
      this.logger.warn(
        `Retención de conversaciones omitida: no se pudieron leer los ajustes (${(err as Error).message})`,
      );
      return { ...result, skipped: true };
    }

    const platformDefault = this.settings.defaultRetentionDays;
    // Días resueltos (política diferenciada > retención del workspace > 180 por defecto) para un workspace concreto.
    const resolverDias = (ws: string): number | null => {
      const wsRetencion = stored.has(ws) ? (stored.get(ws)!.conversationRetentionDays ?? null) : platformDefault;
      return resolverRetencion(policiesByWs.get(ws) ?? [], wsRetencion, ALCANCE_CONVERSACIONES).retencionDias;
    };

    // Workspaces con ajustes o políticas propias se resuelven uno a uno; el resto hereda el valor de plataforma.
    const explicitWsIds = new Set<string>([...stored.keys(), ...policiesByWs.keys()]);
    const targets: { workspaceId?: string; exclude?: string[]; days: number }[] = [];
    if (workspaceId) {
      const days = resolverDias(workspaceId);
      if (days) targets.push({ workspaceId, days });
    } else {
      for (const ws of explicitWsIds) {
        const days = resolverDias(ws);
        if (days) targets.push({ workspaceId: ws, days });
      }
      // El resto (sin ajustes ni políticas) usa la retención de plataforma (180 por defecto).
      if (platformDefault) targets.push({ exclude: [...explicitWsIds], days: platformDefault });
    }

    for (const t of targets) {
      const cutoff = new Date(now.getTime() - t.days * DAY_MS);
      const ws = t.workspaceId ? { equals: t.workspaceId } : { notIn: t.exclude ?? [] };
      const [conversations, copilotSessions, feedback] = await this.prisma.$transaction([
        this.prisma.conversation.deleteMany({ where: { agent: { workspaceId: ws }, updatedAt: { lt: cutoff } } }),
        this.prisma.copilotSession.deleteMany({ where: { workspaceId: ws, updatedAt: { lt: cutoff } } }),
        this.prisma.messageFeedback.deleteMany({ where: { workspaceId: ws, createdAt: { lt: cutoff } } }),
      ]);
      result.conversations += conversations.count;
      result.copilotSessions += copilotSessions.count;
      result.feedback += feedback.count;
      result.workspaces += t.workspaceId ? 1 : 0;
    }
    if (targets.length) {
      this.logger.log(
        `Retención de conversaciones: ${result.conversations} conversaciones, ${result.copilotSessions} sesiones del ` +
          `Copilot y ${result.feedback} calificaciones eliminadas`,
      );
    }
    return result;
  }
}
