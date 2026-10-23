import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type FeedbackRating } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { requireUser } from './copilot.service';
import { COPILOT_VERSION } from './definition/copilot.definition';

/** Conversación que el usuario decidió compartir con Nexo junto con su calificación. */
export interface SharedConversation {
  sessionId: string;
  mode: string;
  copilotVersion: string;
  messages: { role: 'user' | 'assistant'; text: string }[];
}

/**
 * Calificación 👍/👎 de las respuestas del Copilot (ADR 0006 D6). Nexo solo ve el contenido de la conversación si el
 * usuario marca `shareConversation`; si luego califica sin compartir, la copia se elimina.
 */
@Injectable()
export class CopilotFeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async rate(
    a: AuthContext,
    messageId: string,
    dto: { rating: FeedbackRating; comment?: string; shareConversation?: boolean },
  ) {
    const auth = requireUser(a);
    const message = await this.prisma.copilotMessage.findFirst({
      where: { id: messageId, session: { userId: auth.userId, workspaceId: auth.workspaceId } },
      include: { session: { select: { id: true, mode: true } } },
    });
    if (!message) throw new NotFoundException('Mensaje del Copilot no encontrado');
    if (message.role !== 'assistant') throw new BadRequestException('Solo se califican las respuestas del Copilot');

    let shared: SharedConversation | null = null;
    if (dto.shareConversation) {
      const messages = await this.prisma.copilotMessage.findMany({
        where: { sessionId: message.sessionId, createdAt: { lte: message.createdAt } },
        orderBy: { createdAt: 'asc' },
        select: { role: true, text: true },
      });
      shared = {
        sessionId: message.session.id,
        mode: message.session.mode,
        copilotVersion: COPILOT_VERSION,
        messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant', text: m.text })),
      };
    }
    const data = {
      rating: dto.rating,
      comment: dto.comment?.trim() || null,
      sharedConversation: shared ? (shared as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    };
    const feedback = await this.prisma.copilotFeedback.upsert({
      where: { messageId },
      create: { messageId, workspaceId: auth.workspaceId, userId: auth.userId, ...data },
      update: data,
    });
    return {
      id: feedback.id,
      messageId,
      rating: feedback.rating,
      comment: feedback.comment,
      shared: !!shared,
      createdAt: feedback.createdAt,
    };
  }
}
