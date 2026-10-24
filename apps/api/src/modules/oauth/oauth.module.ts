import { Module } from '@nestjs/common';
import { SingleUseModule } from '../../infrastructure/redis/single-use.module';
import { PlatformAdminGuard, PlatformAdminService } from '../copilot/platform/platform-admin.guard';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { OAuthStateService } from './oauth-state.service';
import { PlatformOAuthAppsController } from './platform-oauth-apps.controller';
import { PlatformOAuthAppsService } from './platform-oauth-apps.service';

/**
 * ADR 0005 (D3): OAuth2 de usuario (authorization code + PKCE + refresh) para conectores.
 * No depende de ConnectorsModule: ConnectorsModule lo importa para resolver tokens en `AuthResolverService`.
 * Las apps OAuth de la plataforma se configuran desde la consola de plataforma (`PlatformOAuthAppsController`).
 */
@Module({
  imports: [SingleUseModule],
  controllers: [OAuthController, PlatformOAuthAppsController],
  providers: [OAuthService, OAuthStateService, PlatformOAuthAppsService, PlatformAdminService, PlatformAdminGuard],
  exports: [OAuthService, OAuthStateService, PlatformOAuthAppsService],
})
export class OAuthModule {}
