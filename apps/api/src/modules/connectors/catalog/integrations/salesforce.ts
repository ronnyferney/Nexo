import { OAUTH_PROVIDERS } from '../../../oauth/oauth.providers';
import { PATTERNS, secretRef, WRITE_NOTICE, type CatalogEntry } from '../catalog.types';

const SLUG = 'SALESFORCE';
/** Versión de la API REST; la base real (`instance_url`) llega con el token OAuth. */
export const SALESFORCE_API_VERSION = 'v62.0';
const QUERY_DOCS = 'https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_query.htm';
const CREATE_DOCS =
  'https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_sobject_basic_info_post.htm';

const limitSchema = { type: 'integer', minimum: 1, maximum: 200, description: 'Máximo de registros (por defecto 50)' };
const textFilter = (description: string) => ({ type: 'string', pattern: PATTERNS.soqlText, description });

export const salesforce: CatalogEntry = {
  id: 'salesforce',
  slug: SLUG,
  name: 'Salesforce',
  category: 'CRM',
  description: 'Leads y oportunidades de Salesforce Sales Cloud (API REST, OAuth2 con la cuenta del usuario).',
  icon: 'building',
  docsUrl: 'https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/',
  connectorType: 'REST',
  // Se reemplaza por `<instance_url>/services/data/<versión>` al conectar la cuenta.
  config: { baseUrl: `https://login.salesforce.com/services/data/${SALESFORCE_API_VERSION}` },
  auth: {
    oauth2_code: {
      type: 'oauth2_code',
      provider: 'salesforce',
      authorizeUrl: OAUTH_PROVIDERS.salesforce.authorizeUrl,
      tokenUrl: OAUTH_PROVIDERS.salesforce.tokenUrl,
      revokeUrl: OAUTH_PROVIDERS.salesforce.revokeUrl,
      scopes: ['api', 'refresh_token'],
      clientIdRef: secretRef(SLUG, 'clientId'),
      clientSecretRef: secretRef(SLUG, 'clientSecret'),
      instanceUrl: {
        field: 'instance_url',
        allowedHostSuffixes: ['.salesforce.com', '.force.com'],
        baseUrlSuffix: `/services/data/${SALESFORCE_API_VERSION}`,
      },
      // Salesforce no envía expires_in (depende del timeout de sesión, mínimo 15 min): renovación conservadora.
      defaultExpiresIn: 900,
    },
  },
  credentialFields: [
    {
      key: 'clientId',
      label: 'Consumer key (app conectada propia, opcional)',
      secret: false,
      required: false,
      authMethods: ['oauth2_code'],
      help: 'Vacío = app OAuth de la plataforma Nexo.',
    },
    {
      key: 'clientSecret',
      label: 'Consumer secret (app conectada propia, opcional)',
      secret: true,
      required: false,
      authMethods: ['oauth2_code'],
    },
  ],
  operations: [
    {
      key: 'query_leads',
      name: 'Consultar leads',
      description:
        'Lista leads de Salesforce (más recientes primero) filtrando por texto en nombre, empresa o correo y, ' +
        'opcionalmente, por estado. Úsala para revisar si un prospecto ya existe o para ver la cola de leads.',
      write: false,
      inputSchema: {
        type: 'object',
        properties: {
          search: textFilter('Texto a buscar en nombre, empresa o correo (vacío = todos)'),
          status: textFilter('Estado exacto del lead (ej. "Open - Not Contacted"); vacío = cualquiera'),
          limit: limitSchema,
        },
      },
      definition: {
        method: 'GET',
        path: '/query',
        query: {
          q:
            'SELECT Id, FirstName, LastName, Company, Title, Email, Phone, Status, LeadSource, CreatedDate FROM Lead ' +
            "WHERE (Name LIKE '%{{ input.search | default:'' }}%' OR Company LIKE '%{{ input.search | default:'' }}%' " +
            "OR Email LIKE '%{{ input.search | default:'' }}%') AND Status LIKE '{{ input.status | default:'%' }}' " +
            "ORDER BY CreatedDate DESC LIMIT {{ input.limit | default:'50' }}",
        },
      },
      verified: true,
      docsUrl: QUERY_DOCS,
    },
    {
      key: 'query_opportunities',
      name: 'Consultar oportunidades',
      description:
        'Lista oportunidades de Salesforce por texto en el nombre o la cuenta y, opcionalmente, por etapa, ordenadas ' +
        'por fecha de cierre. Úsala para el seguimiento del pipeline o para preparar una reunión con una cuenta.',
      write: false,
      inputSchema: {
        type: 'object',
        properties: {
          search: textFilter('Texto a buscar en el nombre de la oportunidad o de la cuenta (vacío = todas)'),
          stage: textFilter('Etapa exacta (StageName, ej. "Prospecting"); vacío = cualquiera'),
          limit: limitSchema,
        },
      },
      definition: {
        method: 'GET',
        path: '/query',
        query: {
          q:
            'SELECT Id, Name, StageName, Amount, CloseDate, Probability, NextStep, Account.Name, Owner.Name ' +
            "FROM Opportunity WHERE (Name LIKE '%{{ input.search | default:'' }}%' " +
            "OR Account.Name LIKE '%{{ input.search | default:'' }}%') AND StageName LIKE '{{ input.stage | default:'%' }}' " +
            "ORDER BY CloseDate ASC LIMIT {{ input.limit | default:'50' }}",
        },
      },
      verified: true,
      docsUrl: QUERY_DOCS,
    },
    {
      key: 'create_lead',
      name: 'Crear lead',
      description:
        `Crea un lead en Salesforce ${WRITE_NOTICE}. Úsala para registrar un prospecto nuevo después de verificar ` +
        'con "Consultar leads" que no existe. Apellido y empresa son obligatorios.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['LastName', 'Company'],
        properties: {
          FirstName: { type: 'string', description: 'Nombre' },
          LastName: { type: 'string', description: 'Apellido' },
          Company: { type: 'string', description: 'Empresa' },
          Title: { type: 'string', description: 'Cargo' },
          Email: { type: 'string', format: 'email', description: 'Correo' },
          Phone: { type: 'string', description: 'Teléfono' },
          LeadSource: { type: 'string', description: 'Origen (ej. "Web")' },
          Description: { type: 'string', description: 'Notas de calificación' },
        },
      },
      definition: {
        method: 'POST',
        path: '/sobjects/Lead',
        body: {
          FirstName: '{{ input.FirstName }}',
          LastName: '{{ input.LastName }}',
          Company: '{{ input.Company }}',
          Title: '{{ input.Title }}',
          Email: '{{ input.Email }}',
          Phone: '{{ input.Phone }}',
          LeadSource: '{{ input.LeadSource }}',
          Description: '{{ input.Description }}',
        },
      },
      verified: true,
      docsUrl: CREATE_DOCS,
    },
    {
      key: 'create_opportunity',
      name: 'Crear oportunidad',
      description:
        `Crea una oportunidad en Salesforce ${WRITE_NOTICE}. Úsala cuando un lead calificado se convierte en ` +
        'negocio. Nombre, etapa (StageName) y fecha de cierre (AAAA-MM-DD) son obligatorios.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['Name', 'StageName', 'CloseDate'],
        properties: {
          Name: { type: 'string', description: 'Nombre de la oportunidad' },
          StageName: { type: 'string', description: 'Etapa válida en la organización (ej. "Prospecting")' },
          CloseDate: { type: 'string', format: 'date', description: 'Fecha estimada de cierre (AAAA-MM-DD)' },
          Amount: { type: 'number', description: 'Monto' },
          AccountId: { type: 'string', pattern: PATTERNS.pathId, description: 'Id de la cuenta (opcional)' },
          Description: { type: 'string', description: 'Descripción' },
        },
      },
      definition: {
        method: 'POST',
        path: '/sobjects/Opportunity',
        body: {
          Name: '{{ input.Name }}',
          StageName: '{{ input.StageName }}',
          CloseDate: '{{ input.CloseDate }}',
          Amount: '{{ input.Amount }}',
          AccountId: '{{ input.AccountId }}',
          Description: '{{ input.Description }}',
        },
      },
      verified: true,
      docsUrl: CREATE_DOCS,
    },
  ],
  verified: true,
  verificationNotes:
    'OAuth web server flow con PKCE (/services/oauth2/authorize y /token), instance_url en la respuesta del token y ' +
    'ausencia de expires_in según help.salesforce.com; Query (GET /services/data/vXX.X/query?q=) y creación ' +
    '(POST /sobjects/<Objeto>) según developer.salesforce.com. Se usa login.salesforce.com: orgs que exigen My Domain ' +
    'o sandboxes (test.salesforce.com) requieren ajustar authorizeUrl/tokenUrl con una app conectada propia.',
};
