import { Body, Controller, Get, HttpCode, HttpException, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { CopilotFeedbackService } from './copilot-feedback.service';
import { CopilotProposalsService } from './copilot-proposals.service';
import { CopilotQuotaService } from './copilot-quota.service';
import { CopilotService } from './copilot.service';
import { CopilotFeedbackDto, CopilotMessageDto, CreateCopilotSessionDto } from './dto/copilot.dto';

/**
 * Nexo Copilot (ADR 0006). Cualquier miembro puede conversar con el Copilot (sus herramientas solo leen lo que el
 * usuario puede ver y crean propuestas); aplicar una propuesta verifica los permisos de ADR 0007 en el servicio.
 */
@ApiTags('copilot')
@ApiBearerAuth()
@Controller('copilot')
export class CopilotController {
  constructor(
    private readonly copilot: CopilotService,
    private readonly proposals: CopilotProposalsService,
    private readonly feedback: CopilotFeedbackService,
    private readonly quota: CopilotQuotaService,
  ) {}

  @Post('sessions')
  createSession(@CurrentAuth() a: AuthContext, @Body() dto: CreateCopilotSessionDto) {
    return this.copilot.createSession(a, dto);
  }

  @Get('sessions/:id')
  session(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.copilot.getSession(a, id);
  }

  /** Mensaje al Copilot. Con `stream: true` responde SSE (eventos del chat de agentes + `proposal`). */
  @HttpCode(200)
  @Post('sessions/:id/messages')
  async message(
    @CurrentAuth() a: AuthContext,
    @Param('id') id: string,
    @Body() dto: CopilotMessageDto,
    @Res() res: Response,
  ) {
    // Sesión, permisos y cupo se validan antes de abrir el stream: los errores llegan con su código HTTP.
    const prepared = await this.copilot.prepareTurn(a, id);
    if (!dto.stream) {
      res.json(await this.copilot.send(a, id, dto.message, undefined, undefined, prepared));
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    try {
      const result = await this.copilot.send(a, id, dto.message, (e) => send(e.type, e), abort.signal, prepared);
      send('done', result);
    } catch (err) {
      const body = err instanceof HttpException ? (err.getResponse() as { code?: string }) : undefined;
      send('error', { message: (err as Error).message, ...(body?.code ? { code: body.code } : {}) });
    } finally {
      res.end();
    }
  }

  @Get('proposals/:id')
  proposal(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.proposals.get(a, id);
  }

  @HttpCode(200)
  @Post('proposals/:id/apply')
  apply(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.proposals.apply(a, id);
  }

  @HttpCode(200)
  @Post('proposals/:id/discard')
  discard(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.proposals.discard(a, id);
  }

  @Get('quota')
  quotaStatus(@CurrentAuth() a: AuthContext) {
    return this.quota.status(a.workspaceId);
  }

  @HttpCode(200)
  @Post('messages/:messageId/feedback')
  rate(@CurrentAuth() a: AuthContext, @Param('messageId') messageId: string, @Body() dto: CopilotFeedbackDto) {
    return this.feedback.rate(a, messageId, dto);
  }
}
