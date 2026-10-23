import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { LlmGatewayService } from '../llm/llm-gateway.service';
import { AgentsService } from './agents.service';
import {
  ChatDto,
  CreateAgentDto,
  CreateAgentExampleDto,
  SetAgentKnowledgeDto,
  SetAgentSkillsDto,
  SetAgentToolsDto,
  UpdateAgentDto,
} from './dto/agent.dto';

@ApiTags('agents')
@ApiBearerAuth()
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly gateway: LlmGatewayService,
  ) {}

  /** Alias de GET /llm/catalog (compatibilidad). */
  @Get('providers')
  providers(@CurrentAuth() a: AuthContext) {
    return this.gateway.catalog(a.workspaceId);
  }

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.agents.list(a.workspaceId);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.agents.describe(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateAgentDto) {
    return this.agents.create(a.workspaceId, dto);
  }

  @MinRole('EDITOR')
  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateAgentDto) {
    return this.agents.update(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id')
  remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.agents.remove(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Put(':id/tools')
  setTools(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: SetAgentToolsDto) {
    return this.agents.setTools(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Put(':id/skills')
  setSkills(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: SetAgentSkillsDto) {
    return this.agents.setSkills(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Put(':id/knowledge')
  setKnowledge(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: SetAgentKnowledgeDto) {
    return this.agents.setKnowledge(a.workspaceId, id, dto);
  }

  @Get(':id/examples')
  examples(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.agents.examples(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post(':id/examples')
  addExample(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateAgentExampleDto) {
    return this.agents.addExample(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id/examples/:exampleId')
  removeExample(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Param('exampleId') exampleId: string) {
    return this.agents.removeExample(a.workspaceId, id, exampleId);
  }

  /** System prompt compuesto y herramientas que recibiría el modelo (transparencia, ADR 0003 D2). */
  @Get(':id/prompt-preview')
  promptPreview(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.agents.promptPreview(a.workspaceId, id);
  }

  @Get(':id/conversations')
  conversations(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.agents.conversations(a.workspaceId, id);
  }

  @Get(':id/conversations/:cid')
  conversation(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Param('cid') cid: string) {
    return this.agents.conversation(a.workspaceId, id, cid);
  }

  /** Chat con el agente. Con `stream: true` responde Server-Sent Events. */
  @MinRole('EDITOR')
  @HttpCode(200)
  @Post(':id/chat')
  async chat(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: ChatDto, @Res() res: Response) {
    if (!dto.stream) {
      res.json(await this.agents.chat(a.workspaceId, id, { ...dto, userId: a.userId }));
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
      const result = await this.agents.chat(
        a.workspaceId,
        id,
        { ...dto, userId: a.userId },
        (e) => send(e.type, e),
        abort.signal,
      );
      send('done', result);
    } catch (err) {
      send('error', { message: (err as Error).message });
    } finally {
      res.end();
    }
  }
}
