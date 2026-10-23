import { OAUTH_PROVIDERS } from '../../../oauth/oauth.providers';
import { PATTERNS, secretRef, WRITE_NOTICE, type CatalogEntry } from '../catalog.types';

const SLUG = 'HUBSPOT';
const DOCS = 'https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/guide';

const CONTACT_PROPERTIES = [
  'email',
  'firstname',
  'lastname',
  'phone',
  'company',
  'jobtitle',
  'lifecyclestage',
  'hs_lead_status',
];
const COMPANY_PROPERTIES = ['name', 'domain', 'industry', 'city', 'country', 'numberofemployees', 'annualrevenue'];

/** Esquema común de las búsquedas CRM v3 (texto libre + filtros opcionales + paginación). */
const searchSchema = (what: string) => ({
  type: 'object',
  properties: {
    query: { type: 'string', description: `Texto a buscar en ${what} (nombre, correo, dominio...)` },
    filterGroups: {
      type: 'array',
      description:
        'Filtros avanzados opcionales de HubSpot: [{ "filters": [{ "propertyName": "email", "operator": "EQ", "value": "x" }] }]. ' +
        'Los filtros de un grupo se combinan con Y; los grupos, con O.',
      items: { type: 'object' },
    },
    limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Máximo de resultados (por defecto 10)' },
    after: { type: 'string', description: 'Cursor de paginación (paging.next.after de la respuesta anterior)' },
  },
});

const searchBody = (properties: string[]) => ({
  query: '{{ input.query }}',
  filterGroups: '{{ input.filterGroups }}',
  properties,
  limit: '{{ input.limit }}',
  after: '{{ input.after }}',
});

export const hubspot: CatalogEntry = {
  id: 'hubspot',
  slug: SLUG,
  name: 'HubSpot CRM',
  category: 'CRM',
  description: 'Contactos, empresas, negocios y notas de HubSpot CRM (API CRM v3).',
  icon: 'target',
  docsUrl: DOCS,
  connectorType: 'REST',
  config: { baseUrl: 'https://api.hubapi.com' },
  auth: {
    bearer: { type: 'bearer', token: secretRef(SLUG, 'accessToken') },
    oauth2_code: {
      type: 'oauth2_code',
      provider: 'hubspot',
      authorizeUrl: OAUTH_PROVIDERS.hubspot.authorizeUrl,
      tokenUrl: OAUTH_PROVIDERS.hubspot.tokenUrl,
      scopes: [
        'oauth',
        'crm.objects.contacts.read',
        'crm.objects.contacts.write',
        'crm.objects.companies.read',
        'crm.objects.deals.read',
        'crm.objects.deals.write',
      ],
      clientIdRef: secretRef(SLUG, 'clientId'),
      clientSecretRef: secretRef(SLUG, 'clientSecret'),
    },
  },
  credentialFields: [
    {
      key: 'accessToken',
      label: 'Token de acceso de la app privada',
      secret: true,
      required: true,
      authMethods: ['bearer'],
      help: 'HubSpot → Configuración → Integraciones → Apps privadas. Alcances: contacts, companies y deals (lectura/escritura).',
    },
    {
      key: 'clientId',
      label: 'Client ID (app OAuth propia, opcional)',
      secret: false,
      required: false,
      authMethods: ['oauth2_code'],
      help: 'Vacío = app OAuth de la plataforma Nexo.',
    },
    {
      key: 'clientSecret',
      label: 'Client secret (app OAuth propia, opcional)',
      secret: true,
      required: false,
      authMethods: ['oauth2_code'],
    },
  ],
  operations: [
    {
      key: 'search_contacts',
      name: 'Buscar contactos',
      description:
        'Busca contactos en HubSpot por texto (nombre, correo, teléfono, empresa) o con filtros. Úsala ANTES de crear un ' +
        'contacto para evitar duplicados y para obtener el id de un contacto existente.',
      write: false,
      inputSchema: searchSchema('contactos'),
      definition: { method: 'POST', path: '/crm/v3/objects/contacts/search', body: searchBody(CONTACT_PROPERTIES) },
      verified: true,
      docsUrl:
        'https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/search/post-crm-v3-objects-contacts-search',
    },
    {
      key: 'create_contact',
      name: 'Crear contacto',
      description:
        `Crea un contacto nuevo en HubSpot ${WRITE_NOTICE}. Úsala solo después de buscar y confirmar que no existe ` +
        '(HubSpot rechaza correos duplicados). Devuelve el id del contacto creado.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email', description: 'Correo del contacto' },
          firstname: { type: 'string', description: 'Nombre' },
          lastname: { type: 'string', description: 'Apellido' },
          phone: { type: 'string', description: 'Teléfono' },
          company: { type: 'string', description: 'Empresa' },
          jobtitle: { type: 'string', description: 'Cargo' },
        },
      },
      definition: {
        method: 'POST',
        path: '/crm/v3/objects/contacts',
        body: {
          properties: {
            email: '{{ input.email }}',
            firstname: '{{ input.firstname }}',
            lastname: '{{ input.lastname }}',
            phone: '{{ input.phone }}',
            company: '{{ input.company }}',
            jobtitle: '{{ input.jobtitle }}',
          },
        },
      },
      verified: true,
      docsUrl: DOCS,
    },
    {
      key: 'update_contact',
      name: 'Actualizar contacto',
      description:
        `Actualiza propiedades de un contacto existente de HubSpot por su id ${WRITE_NOTICE}. Úsala para registrar ` +
        'datos nuevos (cargo, teléfono, estado del lead). Obtén el id con "Buscar contactos".',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['contactId', 'properties'],
        properties: {
          contactId: { type: 'string', pattern: PATTERNS.numericId, description: 'Id del contacto en HubSpot' },
          properties: {
            type: 'object',
            description:
              'Propiedades a cambiar con su nombre interno, ej. { "jobtitle": "CTO", "hs_lead_status": "OPEN" }',
            additionalProperties: { type: ['string', 'number', 'boolean'] },
          },
        },
      },
      definition: {
        method: 'PATCH',
        path: '/crm/v3/objects/contacts/{{ input.contactId }}',
        body: { properties: '{{ input.properties }}' },
      },
      verified: true,
      docsUrl: DOCS,
    },
    {
      key: 'create_deal',
      name: 'Crear negocio',
      description:
        `Crea un negocio (deal) en HubSpot asociado a un contacto ${WRITE_NOTICE}. Úsala cuando un lead calificado ` +
        'pasa a oportunidad. Requiere el id interno de la etapa (dealstage) del pipeline.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['dealname', 'dealstage', 'contactId'],
        properties: {
          dealname: { type: 'string', description: 'Nombre del negocio' },
          dealstage: {
            type: 'string',
            description: 'Id interno de la etapa (ej. "appointmentscheduled" en el pipeline por defecto)',
          },
          pipeline: { type: 'string', description: 'Id interno del pipeline (por defecto "default")' },
          amount: { type: ['number', 'string'], description: 'Monto estimado' },
          closedate: { type: 'string', description: 'Fecha estimada de cierre (ISO 8601)' },
          contactId: { type: 'string', pattern: PATTERNS.numericId, description: 'Id del contacto a asociar' },
        },
      },
      definition: {
        method: 'POST',
        path: '/crm/v3/objects/deals',
        body: {
          properties: {
            dealname: '{{ input.dealname }}',
            dealstage: '{{ input.dealstage }}',
            pipeline: "{{ input.pipeline | default:'default' }}",
            amount: '{{ input.amount }}',
            closedate: '{{ input.closedate }}',
          },
          associations: [
            {
              to: { id: '{{ input.contactId }}' },
              types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
            },
          ],
        },
      },
      verified: true,
      docsUrl: 'https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/deals/guide',
    },
    {
      key: 'create_note',
      name: 'Registrar nota',
      description:
        `Registra una nota/actividad en la línea de tiempo de un contacto de HubSpot ${WRITE_NOTICE}. Úsala para dejar ` +
        'constancia de una llamada, reunión o resumen de conversación.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['contactId', 'body', 'timestamp'],
        properties: {
          contactId: { type: 'string', pattern: PATTERNS.numericId, description: 'Id del contacto' },
          body: { type: 'string', maxLength: 65536, description: 'Texto de la nota (admite HTML básico)' },
          timestamp: { type: 'string', description: 'Fecha y hora de la actividad en ISO 8601 UTC (ej. la actual)' },
        },
      },
      definition: {
        method: 'POST',
        path: '/crm/v3/objects/notes',
        body: {
          properties: { hs_note_body: '{{ input.body }}', hs_timestamp: '{{ input.timestamp }}' },
          associations: [
            {
              to: { id: '{{ input.contactId }}' },
              types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
            },
          ],
        },
      },
      verified: true,
      docsUrl: 'https://developers.hubspot.com/docs/api-reference/legacy/crm/activities/notes/guide',
    },
    {
      key: 'search_companies',
      name: 'Buscar empresas',
      description:
        'Busca empresas (cuentas) en HubSpot por nombre o dominio, o con filtros. Úsala para saber si una cuenta ya ' +
        'existe y obtener su id y datos (industria, tamaño, ciudad).',
      write: false,
      inputSchema: searchSchema('empresas'),
      definition: { method: 'POST', path: '/crm/v3/objects/companies/search', body: searchBody(COMPANY_PROPERTIES) },
      verified: true,
      docsUrl: 'https://developers.hubspot.com/docs/api-reference/search/guide',
    },
  ],
  verified: true,
  verificationNotes:
    'API CRM v3 (/crm/v3/objects/...) y tipos de asociación 3 (negocio→contacto) y 202 (nota→contacto) según ' +
    'developers.hubspot.com. HubSpot publica además rutas versionadas por fecha (/crm/objects/2026-09/...); v3 sigue ' +
    'documentada. OAuth: authorize en app.hubspot.com, token en /oauth/v3/token. No se encontró documentación de PKCE ' +
    'para apps estándar (se envía igualmente; el proveedor ignora parámetros desconocidos).',
};
