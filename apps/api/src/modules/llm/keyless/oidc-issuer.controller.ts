import { Controller, Get, Header, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public.decorator';
import { OidcIssuerService } from './oidc-issuer.service';

/**
 * Endpoints públicos del emisor OIDC de Nexo (`${PUBLIC_URL}/api/oidc`): Anthropic los lee para verificar las aserciones
 * de Workload Identity Federation. Solo exponen claves públicas; con límite de peticiones por IP.
 */
@ApiTags('oidc')
@Controller('oidc')
export class OidcIssuerController {
  constructor(private readonly issuer: OidcIssuerService) {}

  private ensureEnabled(): void {
    if (!this.issuer.signingEnabled) throw new NotFoundException('El emisor OIDC de Nexo no está configurado');
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Documento de descubrimiento OIDC del emisor de Nexo' })
  @Get('.well-known/openid-configuration')
  discovery() {
    this.ensureEnabled();
    return this.issuer.discovery();
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Claves públicas (JWKS) del emisor OIDC de Nexo' })
  @Get('jwks')
  jwks() {
    this.ensureEnabled();
    return this.issuer.jwks();
  }
}
