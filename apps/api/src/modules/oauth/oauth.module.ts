import { Module } from '@nestjs/common';
import { SingleUseModule } from '../../infrastructure/redis/single-use.module';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { OAuthStateService } from './oauth-state.service';

/**
 * ADR 0005 (D3): OAuth2 de usuario (authorization code + PKCE + refresh) para conectores.
 * No depende de ConnectorsModule: ConnectorsModule lo importa para resolver tokens en `AuthResolverService`.
 */
@Module({
  imports: [SingleUseModule],
  controllers: [OAuthController],
  providers: [OAuthService, OAuthStateService],
  exports: [OAuthService, OAuthStateService],
})
export class OAuthModule {}
