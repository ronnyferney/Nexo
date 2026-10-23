import { Controller, Delete, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { OAuthService } from './oauth.service';

const asString = (v: unknown): string | undefined => (typeof v === 'string' && v.length <= 4096 ? v : undefined);

/** OAuth2 de usuario para conectores (ADR 0005, D3). */
@ApiTags('oauth')
@ApiBearerAuth()
@Controller()
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @MinRole('EDITOR')
  @HttpCode(200)
  @Post('connectors/:id/oauth/start')
  start(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.oauth.start(a.workspaceId, id, a.userId);
  }

  @Get('connectors/:id/oauth')
  status(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.oauth.status(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Delete('connectors/:id/oauth')
  disconnect(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.oauth.disconnect(a.workspaceId, id);
  }

  /** Callback público del proveedor: siempre redirige a la web (destino fijo en WEB_URL, sin redirección abierta). */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiExcludeEndpoint()
  @Get('oauth/callback')
  async callback(@Query() query: Record<string, unknown>, @Res() res: Response) {
    const target = await this.oauth.callback({
      code: asString(query.code),
      state: asString(query.state),
      error: asString(query.error),
    });
    res.redirect(302, target);
  }
}
