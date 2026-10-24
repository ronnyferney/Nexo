import { Body, Controller, Delete, Get, NotFoundException, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { PlatformAdminGuard } from '../copilot/platform/platform-admin.guard';
import { CATALOG } from '../connectors/catalog/catalog.index';
import { maskClientId, OAuthService } from './oauth.service';
import { OAUTH_PROVIDERS } from './oauth.providers';
import { PlatformOAuthAppsService } from './platform-oauth-apps.service';

class SavePlatformOAuthAppDto {
  @IsString()
  @MinLength(4)
  @MaxLength(200)
  clientId!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(500)
  clientSecret!: string;
}

const LABELS: Record<string, string> = {
  microsoft: 'Microsoft 365',
  google: 'Google',
  slack: 'Slack',
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  linkedin: 'LinkedIn',
};

/**
 * Consola de plataforma → Apps de inicio de sesión: la app OAuth de cada proveedor se configura una sola vez aquí y
 * todos los workspaces conectan sus cuentas con «Iniciar sesión con…» sin ver client IDs ni secretos.
 */
@ApiTags('platform')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller('platform/oauth-apps')
export class PlatformOAuthAppsController {
  constructor(
    private readonly apps: PlatformOAuthAppsService,
    private readonly oauth: OAuthService,
  ) {}

  @Get()
  list() {
    return Object.keys(OAUTH_PROVIDERS).map((provider) => {
      const app = this.apps.get(provider);
      // Permisos que piden las integraciones del catálogo de este proveedor: los que debe tener la app registrada.
      const entries = CATALOG.filter(
        (e) => e.auth.oauth2_code?.type === 'oauth2_code' && e.auth.oauth2_code.provider === provider,
      );
      const scopes = [
        ...new Set(
          entries.flatMap((e) => (e.auth.oauth2_code?.type === 'oauth2_code' ? e.auth.oauth2_code.scopes : [])),
        ),
      ].sort();
      return {
        provider,
        label: LABELS[provider] ?? provider,
        configured: !!app,
        source: app?.source ?? null,
        clientIdHint: app ? maskClientId(app.clientId) : null,
        redirectUri: this.oauth.redirectUri,
        scopes,
        integrations: entries.map((e) => e.name),
      };
    });
  }

  @Put(':provider')
  async save(@CurrentAuth() a: AuthContext, @Param('provider') provider: string, @Body() dto: SavePlatformOAuthAppDto) {
    if (!OAUTH_PROVIDERS[provider]) throw new NotFoundException('Proveedor OAuth desconocido');
    await this.apps.save(provider, dto.clientId, dto.clientSecret, a.userId);
    return { provider, configured: true, source: 'console', clientIdHint: maskClientId(dto.clientId.trim()) };
  }

  @Delete(':provider')
  async remove(@Param('provider') provider: string) {
    if (!OAUTH_PROVIDERS[provider]) throw new NotFoundException('Proveedor OAuth desconocido');
    await this.apps.remove(provider);
    return { provider, removed: true };
  }
}
