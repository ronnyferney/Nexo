import { OAUTH_PROVIDERS } from '../../../oauth/oauth.providers';
import { PATTERNS, secretRef, type CatalogCredentialField, type CatalogEntry } from '../catalog.types';

/** Formato del client ID de una app de Entra ID y explicación del error más común al copiarlo. */
export const MICROSOFT_CLIENT_ID_HINT =
  'El client ID es el "Id. de aplicación (cliente)" de la página Información general de la app en Entra ID ' +
  '(formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)';
export const MICROSOFT_CLIENT_SECRET_HINT =
  'El client secret es la columna "Valor" del secreto en Certificados y secretos, no el "Id. de secreto" ' +
  '(que tiene forma de GUID)';

/**
 * Piezas comunes de las integraciones de Microsoft 365 vía Microsoft Graph v1.0 con OAuth2 de usuario (mismo esquema
 * que `microsoft-outlook.ts`, que no se modifica para no alterar instalaciones existentes).
 */
export const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

/** Página de referencia de la API v1.0 en learn.microsoft.com. */
export const graphDocs = (page: string) => `https://learn.microsoft.com/en-us/graph/api/${page}?view=graph-rest-1.0`;

/** Página de recurso o visión general de la API v1.0 en learn.microsoft.com. */
export const graphResourceDocs = (page: string) =>
  `https://learn.microsoft.com/en-us/graph/api/resources/${page}?view=graph-rest-1.0`;

/** OAuth2 (código + PKCE) contra el tenant `common`; `offline_access` para refresh token y `User.Read` para `/me`. */
export function microsoftGraphAuth(slug: string, scopes: string[]): CatalogEntry['auth'] {
  return {
    oauth2_code: {
      type: 'oauth2_code',
      provider: 'microsoft',
      authorizeUrl: OAUTH_PROVIDERS.microsoft.authorizeUrl,
      tokenUrl: OAUTH_PROVIDERS.microsoft.tokenUrl,
      scopes: ['offline_access', 'User.Read', ...scopes],
      clientIdRef: secretRef(slug, 'clientId'),
      clientSecretRef: secretRef(slug, 'clientSecret'),
      accountLabel: { url: `${GRAPH_BASE_URL}/me`, path: 'userPrincipalName' },
    },
  };
}

/** App propia de Entra ID (opcional): vacío = app OAuth de la plataforma Nexo. */
export function microsoftAppCredentialFields(scopesHelp: string): CatalogCredentialField[] {
  return [
    {
      key: 'clientId',
      label: 'Application (client) ID de Entra ID (app propia, opcional)',
      secret: false,
      required: false,
      authMethods: ['oauth2_code'],
      pattern: PATTERNS.guid,
      invalidHint: MICROSOFT_CLIENT_ID_HINT,
      help: `Vacío = app OAuth de la plataforma Nexo. Con app propia, agregue los permisos delegados: ${scopesHelp}.`,
    },
    {
      key: 'clientSecret',
      label: 'Client secret (app propia, opcional)',
      secret: true,
      required: false,
      authMethods: ['oauth2_code'],
      pattern: PATTERNS.notGuid,
      invalidHint: MICROSOFT_CLIENT_SECRET_HINT,
    },
  ];
}

/** Esquema de entrada para la zona horaria de `Prefer: outlook.timezone`. */
export const timeZoneSchema = (what: string) => ({
  type: 'string',
  pattern: PATTERNS.timeZone,
  description: `${what} (IANA o Windows), ej. "America/Bogota" o "SA Pacific Standard Time"; por defecto UTC`,
});

/** Cabecera `Prefer` de Outlook para expresar las horas de la respuesta en la zona indicada. */
export const preferTimeZoneHeader = { Prefer: `outlook.timezone="{{ input.timeZone | default:'UTC' }}"` };

/** Esquema `dateTimeTimeZone` de Graph (objeto completo: se omite entero si no se envía). */
export const dateTimeTimeZoneSchema = (what: string) => ({
  type: 'object',
  required: ['dateTime', 'timeZone'],
  description: `${what}: { "dateTime": "2026-11-05T15:00:00", "timeZone": "America/Bogota" } (hora local sin desfase)`,
  properties: {
    dateTime: { type: 'string', minLength: 10, maxLength: 40 },
    timeZone: { type: 'string', pattern: PATTERNS.timeZone },
  },
});

/** Id de Graph interpolado en la ruta. */
export const graphIdSchema = (description: string) => ({ type: 'string', pattern: PATTERNS.graphId, description });
