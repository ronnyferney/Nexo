import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import {
  ConnectProviderDto,
  DetectLocalDto,
  DevicePollDto,
  LlmFlowStartDto,
  LlmOAuthStartDto,
} from './dto/llm-providers.dto';
import { LlmAuthFlowsService } from './llm-auth-flows.service';
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
    private readonly flows: LlmAuthFlowsService,
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

  /** «Iniciar sesión con …»: URL de consentimiento del proveedor (OpenRouter, Vertex AI, Azure OpenAI, Hugging Face). */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/oauth/start')
  oauthStart(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: LlmOAuthStartDto) {
    if (id === 'openrouter') return this.openrouter.start(a.workspaceId, a.userId, dto.limit);
    return this.flows.oauthStart(a.workspaceId, a.userId, id, dto);
  }

  /** Código de dispositivo (RFC 8628): el usuario lo ingresa en la página del proveedor. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/device/start')
  deviceStart(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: LlmFlowStartDto) {
    return this.flows.deviceStart(a.workspaceId, a.userId, id, dto);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/device/poll')
  devicePoll(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: DevicePollDto) {
    return this.flows.devicePoll(a.workspaceId, id, dto.flowId);
  }

  /** Detecta un servidor local (Ollama / LM Studio) y lista sus modelos sin guardar nada. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/detect')
  detect(@Param('id') id: string, @Body() dto: DetectLocalDto) {
    return this.providers.detect(id, dto.baseUrl);
  }
}

/** Callback público de los inicios de sesión: siempre redirige a la web (destino fijo en WEB_URL). */
@ApiTags('admin-llm')
@Controller('llm/oauth')
export class LlmOAuthCallbackController {
  constructor(
    private readonly openrouter: OpenRouterOAuthService,
    private readonly flows: LlmAuthFlowsService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiExcludeEndpoint()
  @Get(':provider/callback')
  async callback(@Param('provider') provider: string, @Query() query: Record<string, unknown>, @Res() res: Response) {
    const params = { code: asString(query.code), state: asString(query.state), error: asString(query.error) };
    const target =
      provider === 'openrouter'
        ? await this.openrouter.callback(params)
        : await this.flows.oauthCallback(provider.slice(0, 64), params);
    // El retorno ocurre en la ventana emergente que abrió la consola: con COOP `same-origin` el navegador cortaría
    // `window.opener` y la ventana no podría avisar a Nexo ni cerrarse. El destino siempre es WEB_URL.
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    res.redirect(302, target);
  }
}
