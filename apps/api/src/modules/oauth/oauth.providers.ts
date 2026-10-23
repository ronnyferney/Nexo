/**
 * Proveedores OAuth con app de la plataforma (`OAUTH_<PROVEEDOR>_CLIENT_ID/SECRET`).
 *
 * Cuando un conector usa las credenciales de la plataforma, sus URLs de autorización y de token deben coincidir con
 * las de este registro: así un EDITOR no puede apuntar `tokenUrl` a un servidor propio y capturar el client secret de
 * la plataforma. Con una app propia del cliente (secretos del workspace) las URLs del conector se respetan.
 */
export interface PlatformOAuthProvider {
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  docsUrl: string;
}

export const OAUTH_PROVIDERS: Record<string, PlatformOAuthProvider> = {
  hubspot: {
    authorizeUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl: 'https://api.hubapi.com/oauth/v3/token',
    docsUrl:
      'https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/oauth-quickstart-guide',
  },
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    docsUrl: 'https://developers.google.com/identity/protocols/oauth2/web-server',
  },
  microsoft: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    docsUrl: 'https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow',
  },
  linkedin: {
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    docsUrl: 'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow',
  },
  salesforce: {
    authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
    tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    revokeUrl: 'https://login.salesforce.com/services/oauth2/revoke',
    docsUrl: 'https://help.salesforce.com/s/articleView?id=remoteaccess_oauth_web_server_flow.htm&type=5',
  },
};

/** Nombre de la variable de entorno de la app de la plataforma: `OAUTH_<PROVEEDOR>_CLIENT_ID`. */
export function platformEnvName(provider: string, kind: 'CLIENT_ID' | 'CLIENT_SECRET'): string {
  return `OAUTH_${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${kind}`;
}
