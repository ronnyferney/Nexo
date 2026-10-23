import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { MessageFeedback, Prisma, ReviewStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentsService, MAX_EXAMPLES } from '../agents/agents.service';
import { CreateFeedbackDto, ReviewFeedbackDto } from './dto/training.dto';
import { MAX_EVAL_CASES } from './eval-cases.service';

type FeedbackWithAgent = MessageFeedback & { agent: { name: string } };

const view = (f: FeedbackWithAgent) => ({
  id: f.id,
  agentId: f.agentId,
  agentName: f.agent.name,
  conversationId: f.conversationId,
  userMessage: f.userMessage,
  agentResponse: f.agentResponse,
  rating: f.rating,
  comment: f.comment,
  correction: f.correction,
  status: f.status,
  createdAt: f.createdAt,
  reviewedAt: f.reviewedAt,
});

const LIST_LIMIT = 200;
const WITH_AGENT = { agent: { select: { name: true } } } as const;
const ALREADY_REVIEWED = 'Esta retroalimentación ya fue revisada';

/** Retroalimentación del chat y bandeja de supervisión (ADR 0004, D1). */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
  ) {}

  /** Un 👍 sin corrección no requiere revisión (queda APPROVED); un 👎 o una corrección entran a la bandeja. */
  async create(workspaceId: string, agentId: string, userId: string | undefined, dto: CreateFeedbackDto) {
    await this.agents.get(workspaceId, agentId);
    if (dto.conversationId) await this.agents.conversation(workspaceId, agentId, dto.conversationId);
    const correction = dto.correction?.trim() || null;
    const status: ReviewStatus = dto.rating === 'UP' && !correction ? 'APPROVED' : 'PENDING';
    const created = await this.prisma.messageFeedback.create({
      data: {
        agentId,
        workspaceId,
        userId: userId ?? null,
        conversationId: dto.conversationId ?? null,
        userMessage: dto.userMessage,
        agentResponse: dto.agentResponse,
        rating: dto.rating,
        comment: dto.comment?.trim() || null,
        correction,
        status,
      },
      include: WITH_AGENT,
    });
    return view(created);
  }

  async list(workspaceId: string, filter: { agentId?: string; status?: ReviewStatus }) {
    if (filter.agentId) await this.agents.get(workspaceId, filter.agentId);
    const where: Prisma.MessageFeedbackWhereInput = {
      workspaceId,
      ...(filter.agentId ? { agentId: filter.agentId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const rows = await this.prisma.messageFeedback.findMany({
      where,
      include: WITH_AGENT,
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
    });
    return rows.map(view);
  }

  /**
   * Revisión del supervisor. APPROVE con corrección crea un ejemplo del agente (máx. 20: 409 si está lleno) y,
   * si `addAsEvalCase`, un caso de evaluación con la corrección como respuesta esperada (y el comentario como
   * criterio). Todo en una transacción: si algo falla, la retroalimentación sigue PENDING.
   */
  async review(workspaceId: string, id: string, reviewerId: string | undefined, dto: ReviewFeedbackDto) {
    const fb = await this.prisma.messageFeedback.findFirst({ where: { id, workspaceId } });
    if (!fb) throw new NotFoundException('Retroalimentación no encontrada');
    if (fb.status !== 'PENDING') throw new ConflictException(ALREADY_REVIEWED);
    const reviewed = { reviewedById: reviewerId ?? null, reviewedAt: new Date() };

    if (dto.action === 'DISCARD') {
      const res = await this.prisma.messageFeedback.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'DISCARDED', ...reviewed },
      });
      if (!res.count) throw new ConflictException(ALREADY_REVIEWED);
      return { feedback: await this.one(id), exampleId: null, evalCaseId: null };
    }

    const correction = dto.correction?.trim() || fb.correction?.trim() || null;
    // Transacción interactiva: si otra revisión ganó la carrera o se alcanzó un límite, no queda nada a medias.
    const ids = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.messageFeedback.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'APPROVED', correction, ...reviewed },
      });
      if (!updated.count) throw new ConflictException(ALREADY_REVIEWED);
      let exampleId: string | null = null;
      let evalCaseId: string | null = null;
      if (correction) {
        if ((await tx.agentExample.count({ where: { agentId: fb.agentId } })) >= MAX_EXAMPLES) {
          throw new ConflictException(
            `El agente ya tiene el máximo de ${MAX_EXAMPLES} ejemplos. Elimine alguno antes de aprobar esta corrección.`,
          );
        }
        exampleId = (
          await tx.agentExample.create({
            data: { agentId: fb.agentId, input: fb.userMessage, output: correction },
            select: { id: true },
          })
        ).id;
      }
      if (dto.addAsEvalCase) {
        if ((await tx.evalCase.count({ where: { agentId: fb.agentId } })) >= MAX_EVAL_CASES) {
          throw new ConflictException(`El agente ya tiene el máximo de ${MAX_EVAL_CASES} casos de evaluación.`);
        }
        evalCaseId = (
          await tx.evalCase.create({
            data: {
              agentId: fb.agentId,
              input: fb.userMessage,
              expected: correction,
              criteria: fb.comment,
              tags: ['feedback'],
            },
            select: { id: true },
          })
        ).id;
      }
      return { exampleId, evalCaseId };
    });
    return { feedback: await this.one(id), ...ids };
  }

  private async one(id: string) {
    return view(await this.prisma.messageFeedback.findUniqueOrThrow({ where: { id }, include: WITH_AGENT }));
  }
}
