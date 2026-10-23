import { secretRef, WRITE_NOTICE, type CatalogEntry } from '../catalog.types';

const SLUG = 'PIPEDRIVE';
const PERSONS_DOCS = 'https://developers.pipedrive.com/docs/api/v1/Persons';

const contactList = (what: string) => ({
  type: 'array',
  description: `${what}: [{ "value": "...", "label": "work", "primary": true }]`,
  items: {
    type: 'object',
    required: ['value'],
    properties: {
      value: { type: 'string' },
      label: { type: 'string', enum: ['work', 'home', 'mobile', 'other'] },
      primary: { type: 'boolean' },
    },
  },
});

export const pipedrive: CatalogEntry = {
  id: 'pipedrive',
  slug: SLUG,
  name: 'Pipedrive',
  category: 'CRM',
  description: 'Personas, tratos y notas de Pipedrive CRM (API v2, token de API).',
  icon: 'users',
  docsUrl: 'https://pipedrive.readme.io/docs/pipedrive-api-v2',
  connectorType: 'REST',
  config: { baseUrl: `https://${secretRef(SLUG, 'companyDomain')}.pipedrive.com/api` },
  auth: { apiKey: { type: 'apiKey', in: 'query', name: 'api_token', value: secretRef(SLUG, 'apiToken') } },
  credentialFields: [
    {
      key: 'apiToken',
      label: 'Token de API personal',
      secret: true,
      required: true,
      help: 'Pipedrive → Preferencias personales → API.',
    },
    {
      key: 'companyDomain',
      label: 'Subdominio de la empresa',
      secret: false,
      required: true,
      pattern: '^[a-z0-9][a-z0-9-]{0,62}$',
      help: 'La parte "miempresa" de https://miempresa.pipedrive.com',
    },
  ],
  operations: [
    {
      key: 'search_persons',
      name: 'Buscar personas',
      description:
        'Busca personas (contactos) en Pipedrive por nombre, correo, teléfono o notas. Úsala antes de crear una ' +
        'persona para evitar duplicados y para obtener su id.',
      write: false,
      inputSchema: {
        type: 'object',
        required: ['term'],
        properties: {
          term: { type: 'string', minLength: 2, description: 'Texto a buscar (mínimo 2 caracteres)' },
          fields: { type: 'string', description: 'Campos donde buscar, separados por coma: name,email,phone,notes' },
          exact_match: { type: 'boolean', description: 'Solo coincidencias exactas' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Máximo de resultados' },
        },
      },
      definition: {
        method: 'GET',
        path: '/v2/persons/search',
        query: {
          term: '{{ input.term }}',
          fields: '{{ input.fields }}',
          exact_match: '{{ input.exact_match }}',
          limit: '{{ input.limit }}',
        },
      },
      verified: true,
      docsUrl: PERSONS_DOCS,
    },
    {
      key: 'create_person',
      name: 'Crear persona',
      description:
        `Crea una persona (contacto) en Pipedrive ${WRITE_NOTICE}. Úsala tras confirmar con "Buscar personas" que ` +
        'no existe. Devuelve el id de la persona, necesario para crear tratos y notas.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Nombre completo' },
          emails: contactList('Correos'),
          phones: contactList('Teléfonos'),
          org_id: { type: 'integer', description: 'Id de la organización (opcional)' },
        },
      },
      definition: {
        method: 'POST',
        path: '/v2/persons',
        body: {
          name: '{{ input.name }}',
          emails: '{{ input.emails }}',
          phones: '{{ input.phones }}',
          org_id: '{{ input.org_id }}',
        },
      },
      verified: true,
      docsUrl: PERSONS_DOCS,
    },
    {
      key: 'create_deal',
      name: 'Crear trato',
      description:
        `Crea un trato (deal) en Pipedrive ${WRITE_NOTICE}, opcionalmente vinculado a una persona y organización. ` +
        'Úsala cuando un lead calificado pasa a oportunidad.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', description: 'Título del trato' },
          value: { type: 'number', description: 'Valor monetario' },
          currency: { type: 'string', description: 'Moneda ISO 4217 (ej. COP, USD)' },
          person_id: { type: 'integer', description: 'Id de la persona vinculada' },
          org_id: { type: 'integer', description: 'Id de la organización vinculada' },
          stage_id: { type: 'integer', description: 'Id de la etapa (opcional; por defecto la primera)' },
          expected_close_date: { type: 'string', format: 'date', description: 'Fecha esperada de cierre (AAAA-MM-DD)' },
        },
      },
      definition: {
        method: 'POST',
        path: '/v2/deals',
        body: {
          title: '{{ input.title }}',
          value: '{{ input.value }}',
          currency: '{{ input.currency }}',
          person_id: '{{ input.person_id }}',
          org_id: '{{ input.org_id }}',
          stage_id: '{{ input.stage_id }}',
          expected_close_date: '{{ input.expected_close_date }}',
        },
      },
      verified: true,
      docsUrl: 'https://developers.pipedrive.com/docs/api/v1/Deals',
    },
    {
      key: 'add_note',
      name: 'Agregar nota',
      description:
        `Agrega una nota a un trato, persona u organización de Pipedrive ${WRITE_NOTICE}. Úsala para registrar el ` +
        'resumen de una llamada o reunión. Indica al menos uno de deal_id, person_id u org_id.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['content'],
        anyOf: [{ required: ['deal_id'] }, { required: ['person_id'] }, { required: ['org_id'] }],
        properties: {
          content: { type: 'string', description: 'Contenido de la nota (admite HTML)' },
          deal_id: { type: 'integer', description: 'Id del trato' },
          person_id: { type: 'integer', description: 'Id de la persona' },
          org_id: { type: 'integer', description: 'Id de la organización' },
        },
      },
      definition: {
        method: 'POST',
        path: '/v1/notes',
        body: {
          content: '{{ input.content }}',
          deal_id: '{{ input.deal_id }}',
          person_id: '{{ input.person_id }}',
          org_id: '{{ input.org_id }}',
        },
      },
      verified: true,
      docsUrl: 'https://developers.pipedrive.com/docs/api/v1/Notes',
    },
  ],
  verified: true,
  verificationNotes:
    'Rutas /api/v2/persons/search, /api/v2/persons, /api/v2/deals y /v1/notes (sin versión v2 de notas) y el token ' +
    'como parámetro api_token según developers.pipedrive.com y la guía de migración a v2. Base ' +
    'https://<subdominio>.pipedrive.com/api.',
};
