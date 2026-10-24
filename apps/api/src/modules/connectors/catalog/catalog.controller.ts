import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentAuth, type AuthContext } from '../../../common/decorators/current-user.decorator';
import { MinRole } from '../../../common/decorators/roles.decorator';
import { CONNECTOR_OAUTH_COOKIE, OAuthService } from '../../oauth/oauth.service';
import { InstallCatalogDto } from './catalog.dto';
import { CatalogService } from './catalog.service';

/** Catálogo de conectores nativos (ADR 0005, D2). */
@ApiTags('connector-catalog')
@ApiBearerAuth()
@Controller('connector-catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly oauth: OAuthService,
  ) {}

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.catalog.list(a.workspaceId);
  }

  /** Cuentas instaladas de una integración, con su estado de conexión (sin secretos ni tokens). */
  @Get(':id/accounts')
  accounts(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.catalog.accounts(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post('starter-kit/commercial')
  commercialKit(@CurrentAuth() a: AuthContext) {
    return this.catalog.installCommercialKit(a.workspaceId);
  }

  @MinRole('EDITOR')
  @Post(':id/install')
  async install(
    @CurrentAuth() a: AuthContext,
    @Param('id') id: string,
    @Body() dto: InstallCatalogDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { body, browserNonce } = await this.catalog.install(a, id, dto);
    // OAuth: el consentimiento que abre `authorizeUrl` queda ligado a este navegador (M1b).
    if (browserNonce) CONNECTOR_OAUTH_COOKIE.set(res, browserNonce, this.oauth.secureCookies);
    return body;
  }
}
