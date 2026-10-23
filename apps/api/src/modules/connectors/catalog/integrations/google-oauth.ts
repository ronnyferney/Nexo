/** Piezas comunes de las integraciones de Google (OAuth2 de la plataforma o app propia del cliente). */
import type { OAuth2CodeAuth } from '../../domain/connector.types';
import { OAUTH_PROVIDERS } from '../../../oauth/oauth.providers';
import { secretRef, type CatalogCredentialField } from '../catalog.types';

/** OAuth de Google: `access_type=offline` + `prompt=consent` para recibir refresh token; correo como etiqueta. */
export function googleOAuth(slug: string, scopes: string[]): OAuth2CodeAuth {
  return {
    type: 'oauth2_code',
    provider: 'google',
    authorizeUrl: OAUTH_PROVIDERS.google.authorizeUrl,
    tokenUrl: OAUTH_PROVIDERS.google.tokenUrl,
    revokeUrl: OAUTH_PROVIDERS.google.revokeUrl,
    scopes: ['openid', 'email', ...scopes],
    clientIdRef: secretRef(slug, 'clientId'),
    clientSecretRef: secretRef(slug, 'clientSecret'),
    authorizeParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    accountLabel: { url: 'https://openidconnect.googleapis.com/v1/userinfo', path: 'email' },
  };
}

export const googleOwnAppFields: CatalogCredentialField[] = [
  {
    key: 'clientId',
    label: 'Client ID de Google Cloud (app propia, opcional)',
    secret: false,
    required: false,
    authMethods: ['oauth2_code'],
    help: 'Vacío = app OAuth de la plataforma Nexo.',
  },
  {
    key: 'clientSecret',
    label: 'Client secret (app propia, opcional)',
    secret: true,
    required: false,
    authMethods: ['oauth2_code'],
  },
];
