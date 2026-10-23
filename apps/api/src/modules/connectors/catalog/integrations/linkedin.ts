import { OAUTH_PROVIDERS } from '../../../oauth/oauth.providers';
import { PATTERNS, secretRef, WRITE_NOTICE, type CatalogEntry } from '../catalog.types';

const SLUG = 'LINKEDIN';
const DOCS_POSTS = 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api';
const DOCS_SHARE = 'https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin';
const DOCS_OIDC =
  'https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2';
const DOCS_ORG =
  'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role';

/** Cuerpo común de la Posts API (`/rest/posts`): texto, visibilidad pública y distribución en el feed principal. */
const postBody = (author: string) => ({
  author,
  commentary: '{{ input.text }}',
  visibility: 'PUBLIC',
  distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
  lifecycleState: 'PUBLISHED',
  isReshareDisabledByAuthor: false,
});

const textSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 3000,
  description: 'Texto de la publicación (máx. 3.000 caracteres). Admite saltos de línea y #hashtags.',
};

/**
 * LinkedIn (API oficial). Alcance real de la plataforma:
 * - Autoservicio: perfil propio (OpenID Connect: `openid profile email`) y publicar como persona (`w_member_social`).
 * - Requiere aprobación de LinkedIn (producto Community Management API) y rol de administrador en la página:
 *   publicar como empresa (`w_organization_social`) y listar páginas administradas (`r_organization_admin`).
 * - LinkedIn NO ofrece búsqueda de personas ni extracción de perfiles a apps generales: para prospección use Lusha.
 */
export const linkedin: CatalogEntry = {
  id: 'linkedin',
  slug: SLUG,
  name: 'LinkedIn',
  category: 'MENSAJERIA',
  description:
    'Publicar en LinkedIn como persona o como página de empresa (API oficial). La prospección de personas no está ' +
    'disponible en la API de LinkedIn: combine con Lusha.',
  icon: 'send',
  docsUrl: DOCS_POSTS,
  connectorType: 'REST',
  config: {
    baseUrl: 'https://api.linkedin.com',
    headers: {
      'LinkedIn-Version': secretRef(SLUG, 'apiVersion'),
      'X-Restli-Protocol-Version': '2.0.0',
    },
  },
  auth: {
    oauth2_code: {
      type: 'oauth2_code',
      provider: 'linkedin',
      authorizeUrl: OAUTH_PROVIDERS.linkedin.authorizeUrl,
      tokenUrl: OAUTH_PROVIDERS.linkedin.tokenUrl,
      scopes: ['openid', 'profile', 'email', 'w_member_social'],
      clientIdRef: secretRef(SLUG, 'clientId'),
      clientSecretRef: secretRef(SLUG, 'clientSecret'),
      accountLabel: { url: 'https://api.linkedin.com/v2/userinfo', path: 'name' },
      // El flujo web estándar de LinkedIn no documenta PKCE (solo para apps nativas aprobadas).
      pkce: false,
    },
  },
  credentialFields: [
    {
      key: 'apiVersion',
      label: 'Versión de la API (LinkedIn-Version, AAAAMM)',
      secret: false,
      required: true,
      default: '202509',
      pattern: String.raw`^20[0-9]{2}(0[1-9]|1[0-2])$`,
      help: 'LinkedIn mantiene cada versión mensual ~1 año. Actualícela si LinkedIn la retira (error 426/400 de versión).',
    },
    {
      key: 'clientId',
      label: 'Client ID (app de LinkedIn propia, opcional)',
      secret: false,
      required: false,
      authMethods: ['oauth2_code'],
      help:
        'Vacío = app OAuth de la plataforma Nexo. Para publicar como empresa, use una app propia con el producto ' +
        '"Community Management API" aprobado y agregue los alcances w_organization_social y r_organization_admin.',
    },
    {
      key: 'clientSecret',
      label: 'Client secret (app de LinkedIn propia, opcional)',
      secret: true,
      required: false,
      authMethods: ['oauth2_code'],
    },
  ],
  operations: [
    {
      key: 'get_my_profile',
      name: 'Mi perfil de LinkedIn',
      description:
        'Obtiene el perfil de la cuenta conectada (nombre, correo, foto e identificador "sub"). Úsala ANTES de publicar ' +
        'como persona: el campo "sub" es el personId que requiere "Publicar como persona".',
      write: false,
      inputSchema: { type: 'object', properties: {} },
      definition: { method: 'GET', path: '/v2/userinfo' },
      verified: true,
      docsUrl: DOCS_OIDC,
    },
    {
      key: 'create_member_post',
      name: 'Publicar como persona',
      description:
        `Publica un texto en el feed de LinkedIn de la persona conectada ${WRITE_NOTICE}. Es una publicación pública ` +
        'con el nombre del usuario: úsala solo con aprobación explícita del contenido. Obtén personId con "Mi perfil de LinkedIn".',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['personId', 'text'],
        properties: {
          personId: { type: 'string', pattern: PATTERNS.pathId, description: 'Campo "sub" de "Mi perfil de LinkedIn"' },
          text: textSchema,
        },
      },
      definition: { method: 'POST', path: '/rest/posts', body: postBody('urn:li:person:{{ input.personId }}') },
      verified: true,
      docsUrl: DOCS_SHARE,
    },
    {
      key: 'list_admin_organizations',
      name: 'Páginas de empresa que administro',
      description:
        'Lista las páginas de empresa donde el usuario conectado es administrador (requiere el producto Community ' +
        'Management API aprobado y el alcance r_organization_admin). Úsala para obtener el organizationId antes de publicar como empresa.',
      write: false,
      inputSchema: { type: 'object', properties: {} },
      definition: {
        method: 'GET',
        path: '/rest/organizationAcls',
        query: { q: 'roleAssignee', role: 'ADMINISTRATOR', state: 'APPROVED' },
      },
      verified: false,
      docsUrl: DOCS_ORG,
    },
    {
      key: 'create_organization_post',
      name: 'Publicar como página de empresa',
      description:
        `Publica un texto en la página de empresa en LinkedIn ${WRITE_NOTICE}. Requiere el producto Community Management ` +
        'API aprobado, el alcance w_organization_social y que el usuario sea administrador de la página. Publicación ' +
        'pública con la marca de la empresa: úsala solo con aprobación explícita.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['organizationId', 'text'],
        properties: {
          organizationId: {
            type: 'string',
            pattern: PATTERNS.numericId,
            description: 'Id numérico de la página de empresa',
          },
          text: textSchema,
        },
      },
      definition: {
        method: 'POST',
        path: '/rest/posts',
        body: postBody('urn:li:organization:{{ input.organizationId }}'),
      },
      verified: false,
      docsUrl: DOCS_POSTS,
    },
  ],
  verified: false,
  verificationNotes:
    'Sin acceso directo a la documentación desde el entorno de desarrollo: endpoints y alcances contrastados con ' +
    'búsquedas sobre learn.microsoft.com y guías de terceros. Pendiente de prueba con una app real: valor vigente de ' +
    'LinkedIn-Version, respuesta de /rest/organizationAcls y comportamiento sin PKCE.',
};
