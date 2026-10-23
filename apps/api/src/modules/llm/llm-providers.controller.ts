import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { ConnectProviderDto, OpenRouterOAuthStartDto } from './dto/llm-providers.dto';
import { LlmProvidersService } from './llm-providers.service';
import { OpenRouterOAuthService } from './openrouter-oauth.service';

const asString = (v: unknown): string | undefined => (typeof v === 'string' && v.length <= 4096 ? v : undefined);

/** Galería de proveedores IA "conectar en un clic" (ADR 0002, D8). Solo ADMIN/OWNER. */
@ApiTags('admin-llm')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('admin/llm/providers')
export class LlmProvidersController {
  constructor(
    private readonly providers: LlmProvidersService,
    private readonly openrouter: OpenRouterOAuthService,
  ) {}

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.providers.list(a.workspaceId);
  }

  /** Valida, prueba la conexión contra el proveedor y solo entonces la guarda. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/connect')
  connect(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: ConnectProviderDto) {
    return this.providers.connect(a.workspaceId, id, dto);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':id/discover')
  discover(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Query('connectionId') connectionId?: string) {
    return this.providers.discover(a.workspaceId, id, asString(connectionId));
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('openrouter/oauth/start')
  openRouterStart(@CurrentAuth() a: AuthContext, @Body() dto: OpenRouterOAuthStartDto) {
    return this.openrouter.start(a.workspaceId, a.userId, dto.limit);
  }
}

/** Callback público del OAuth de OpenRouter: siempre redirige a la web (destino fijo en WEB_URL). */
@ApiTags('admin-llm')
@Controller('llm/oauth/openrouter')
export class LlmOAuthCallbackController {
  constructor(private readonly openrouter: OpenRouterOAuthService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiExcludeEndpoint()
  @Get('callback')
  async callback(@Query() query: Record<string, unknown>, @Res() res: Response) {
    const target = await this.openrouter.callback({
      code: asString(query.code),
      state: asString(query.state),
      error: asString(query.error),
    });
    res.redirect(302, target);
  }
}
