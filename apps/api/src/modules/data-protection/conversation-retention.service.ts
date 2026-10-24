import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PrivacySettingsService } from './privacy-settings.service';

const DAY_MS = 24 * 60 * 60 * 1000;

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
 * Retención de conversaciones (ADR 0008 D7): borra las conversaciones y los mensajes sin actividad durante más de los
 * días configurados por workspace (o `CONVERSATIONS_RETENTION_DAYS` para los que no fijaron ninguno). Se ejecuta en el
 * job diario de retención de la cola de flujos (`RetentionService`); el reconciliador de programadores ignora ese
 * programador porque no lleva el prefijo de flujos ni de rutinas. Solo registra conteos, nunca contenido.
 */
@Injectable()
export class ConversationRetentionService {
  private readonly logger = new Logger(ConversationRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PrivacySettingsService,
  ) {}

  /** `workspaceId` acota la purga a un workspace (pruebas y soporte); el job diario recorre todos. */
  async purge(now = new Date(), workspaceId?: string): Promise<ConversationPurgeResult> {
    const result: ConversationPurgeResult = { conversations: 0, copilotSessions: 0, feedback: 0, workspaces: 0 };
    let stored: Map<string, { conversationRetentionDays: number | null }>;
    try {
      stored = await this.settings.all();
    } catch (err) {
      this.logger.warn(
        `Retención de conversaciones omitida: no se pudieron leer los ajustes (${(err as Error).message})`,
      );
      return { ...result, skipped: true };
    }

    const targets: { workspaceId?: string; exclude?: string[]; days: number }[] = [];
    for (const [ws, s] of stored) {
      if (workspaceId && ws !== workspaceId) continue;
      if (s.conversationRetentionDays) targets.push({ workspaceId: ws, days: s.conversationRetentionDays });
    }
    const fallback = this.settings.defaultRetentionDays;
    if (fallback) {
      if (workspaceId) {
        if (!stored.has(workspaceId)) targets.push({ workspaceId, days: fallback });
      } else {
        targets.push({ exclude: [...stored.keys()], days: fallback });
      }
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
