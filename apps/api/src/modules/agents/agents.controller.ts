import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { AgentAccessService } from '../agent-access/agent-access.service';
import { LlmGatewayService } from '../llm/llm-gateway.service';
import { AgentLifecycleService } from './agent-lifecycle.service';
import { AgentsService } from './agents.service';
import {
  ChatDto,
  CreateAgentDto,
  CreateAgentExampleDto,
  DuplicateAgentDto,
  LaunchAgentDto,
  ListAgentsQueryDto,
  SetAgentKnowledgeDto,
  SetAgentSkillsDto,
  SetAgentToolsDto,
  SetSharesDto,
  SetVisibilityDto,
  TransferAgentDto,
  UpdateAgentDto,
} from './dto/agent.dto';

/**
 * Agentes (ADR 0003/0006/0007). La autorización por agente la decide `AgentAccessService` (404 si no es visible,
 * 403 si falta el permiso), no el rol del workspace: por eso estas rutas ya no llevan `@MinRole('EDITOR')`. Un
 * VIEWER puede crear y editar SUS agentes privados; el rol sigue siendo un tope (TEAM/WORKSPACE y compartir exigen
 * EDITOR+, y un VIEWER no edita agentes ajenos aunque tenga share EDIT).
 */
@ApiTags('agents')
@ApiBearerAuth()
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly lifecycle: AgentLifecycleService,
    private readonly access: AgentAccessService,
    private readonly gateway: LlmGatewayService,
  ) {}

  /** Alias de GET /llm/catalog (compatibilidad). */
  @Get('providers')
  providers(@CurrentAuth() a: AuthContext) {
    return this.gateway.catalog(a.workspaceId);
  }

  @Get()
  list(@CurrentAuth() a: AuthContext, @Query() q: ListAgentsQueryDto) {
    return this.agents.list(a, q.scope);
  }

  /** Agentes de equipo o empresa que el usuario puede usar y que no son suyos. */
  @Get('explore')
  explore(@CurrentAuth() a: AuthContext) {
    return this.lifecycle.explore(a);
  }

  /** Resumen de salud de los agentes visibles (ADMIN/OWNER: todos). */
  @Get('health')
  healthSummary(@CurrentAuth() a: AuthContext) {
    return this.lifecycle.healthSummary(a);
  }

  @Get(':id')
  async get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    const { permission } = await this.access.assert(a, id, 'USE');
    return this.agents.describe(a.workspaceId, id, { auth: a, permission });
  }

  /** Cualquier miembro crea agentes PRIVATE (si el workspace lo permite); TEAM exige EDITOR+. */
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateAgentDto) {
    return this.agents.create(a, dto);
  }

  @Patch(':id')
  async update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateAgentDto) {
    await this.access.assert(a, id, 'EDIT');
    return this.agents.update(a.workspaceId, id, dto);
  }

  /** Eliminar: dueño o administración (un share EDIT no basta). */
  @Delete(':id')
  async remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    const access = await this.access.assert(a, id, 'EDIT');
    this.lifecycle.assertOwnerOrAdmin(a, access, 'eliminar');
    return this.agents.remove(a.workspaceId, id);
  }

  @Get(':id/health')
  async health(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.access.assert(a, id, 'USE');
    return this.lifecycle.healthOf(a, id);
  }

  @HttpCode(200)
  @Post(':id/launch')
  async launch(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: LaunchAgentDto) {
    return this.lifecycle.launch(a, await this.access.assert(a, id, 'EDIT'), dto);
  }

  @HttpCode(200)
  @Post(':id/unlaunch')
  async unlaunch(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.lifecycle.unlaunch(a, await this.access.assert(a, id, 'EDIT'));
  }

  @Patch(':id/visibility')
  async setVisibility(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: SetVisibilityDto) {
    return this.lifecycle.setVisibility(a, await this.access.assert(a, id, 'EDIT'), dto.visibility);
  }

  @Put(':id/shares')
  async setShares(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: SetSharesDto) {
    return this.lifecycle.setShares(a, await this.access.assert(a, id, 'EDIT'), dto);
  }

  @HttpCode(200)
  @Post(':id/transfer')
  async transfer(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: TransferAgentDto) {
    return this.lifecycle.transfer(a, await this.access.assert(a, id, 'EDIT'), dto.userId);
  }

  @Post(':id/duplicate')
  async duplicate(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: DuplicateAgentDto) {
    return this.lifecycle.duplicate(a, await this.access.assert(a, id, 'USE'), dto);
  }

  @Put(':id/tools')
  async setTools(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: SetAgentToolsDto) {
    await this.access.assert(a, id, 'EDIT');
    return this.agents.setTools(a.workspaceId, id, dto);
  }

  @Put(':id/skills')
  async setSkills(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: SetAgentSkillsDto) {
    await this.access.assert(a, id, 'EDIT');
    return this.agents.setSkills(a.workspaceId, id, dto);
  }

  @Put(':id/knowledge')
  async setKnowledge(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: SetAgentKnowledgeDto) {
    await this.access.assert(a, id, 'EDIT');
    return this.agents.setKnowledge(a.workspaceId, id, dto);
  }

  @Get(':id/examples')
  async examples(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.access.assert(a, id, 'USE');
    return this.agents.examples(a.workspaceId, id);
  }

  @Post(':id/examples')
  async addExample(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateAgentExampleDto) {
    await this.access.assert(a, id, 'EDIT');
    return this.agents.addExample(a.workspaceId, id, dto);
  }

  @Delete(':id/examples/:exampleId')
  async removeExample(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Param('exampleId') exampleId: string) {
    await this.access.assert(a, id, 'EDIT');
    return this.agents.removeExample(a.workspaceId, id, exampleId);
  }

  /** System prompt compuesto y herramientas que recibiría el modelo (transparencia, ADR 0003 D2). */
  @Get(':id/prompt-preview')
  async promptPreview(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.access.assert(a, id, 'USE');
    return this.agents.promptPreview(a.workspaceId, id);
  }

  /** Solo las conversaciones propias (las heredadas sin usuario: solo ADMIN/OWNER). */
  @Get(':id/conversations')
  async conversations(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.access.assert(a, id, 'USE');
    return this.agents.conversations(a, id);
  }

  @Get(':id/conversations/:cid')
  async conversation(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Param('cid') cid: string) {
    await this.access.assert(a, id, 'USE');
    return this.agents.conversation(a, id, cid);
  }

  /** Chat con el agente (requiere USE). Con `stream: true` responde Server-Sent Events. */
  @HttpCode(200)
  @Post(':id/chat')
  async chat(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: ChatDto, @Res() res: Response) {
    await this.access.assert(a, id, 'USE');
    if (!dto.stream) {
      res.json(await this.agents.chat(a, id, dto));
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
      const result = await this.agents.chat(a, id, dto, (e) => send(e.type, e), abort.signal);
      send('done', result);
    } catch (err) {
      send('error', { message: (err as Error).message });
    } finally {
      res.end();
    }
  }
}
