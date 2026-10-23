import { secretRef, type CatalogEntry } from '../catalog.types';

const REST_SLUG = 'LUSHA';
const REST_DOCS = 'https://docs.lusha.com/apis/openapi';

/** Lusha API REST v2: enriquecimiento de persona y de empresa. */
export const lushaRest: CatalogEntry = {
  id: 'lusha',
  slug: REST_SLUG,
  name: 'Lusha (API REST)',
  category: 'PROSPECCION',
  description: 'Enriquecimiento de contactos y empresas con datos de Lusha (correo, teléfono, cargo, firmográficos).',
  icon: 'search',
  docsUrl: REST_DOCS,
  connectorType: 'REST',
  config: { baseUrl: 'https://api.lusha.com' },
  auth: { apiKey: { type: 'apiKey', in: 'header', name: 'api_key', value: secretRef(REST_SLUG, 'apiKey') } },
  credentialFields: [
    {
      key: 'apiKey',
      label: 'API key de Lusha',
      secret: true,
      required: true,
      help: 'Lusha → API Hub → Manage API Keys.',
    },
  ],
  operations: [
    {
      key: 'enrich_person',
      name: 'Enriquecer persona',
      description:
        'Obtiene datos de contacto y profesionales (correo, teléfono, cargo, empresa) de UNA persona. Úsala cuando ya ' +
        'conoces a la persona y necesitas completar su ficha. Indica correo, o URL de LinkedIn, o nombre + apellido + ' +
        'empresa (nombre o dominio). Consume créditos de Lusha: no la llames repetidamente para la misma persona.',
      write: false,
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Correo conocido de la persona' },
          linkedinUrl: { type: 'string', description: 'URL del perfil de LinkedIn' },
          firstName: { type: 'string', description: 'Nombre' },
          lastName: { type: 'string', description: 'Apellido' },
          companyName: { type: 'string', description: 'Nombre de la empresa donde trabaja' },
          companyDomain: { type: 'string', description: 'Dominio web de la empresa (ej. acme.com)' },
        },
      },
      definition: {
        method: 'GET',
        path: '/v2/person',
        query: {
          email: '{{ input.email }}',
          linkedinUrl: '{{ input.linkedinUrl }}',
          firstName: '{{ input.firstName }}',
          lastName: '{{ input.lastName }}',
          companyName: '{{ input.companyName }}',
          companyDomain: '{{ input.companyDomain }}',
        },
      },
      verified: true,
      docsUrl: 'https://docs.lusha.com/apis/openapi/person-enrichment',
    },
    {
      key: 'enrich_company',
      name: 'Enriquecer empresa',
      description:
        'Obtiene datos firmográficos de UNA empresa (industria, tamaño, ingresos, ubicación, redes). Úsala para ' +
        'calificar una cuenta o preparar una reunión. Indica el dominio (preferido) o el nombre de la empresa. ' +
        'Consume créditos de Lusha.',
      write: false,
      inputSchema: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Dominio web de la empresa (ej. acme.com)' },
          company: { type: 'string', description: 'Nombre de la empresa (si no se conoce el dominio)' },
        },
      },
      definition: {
        method: 'GET',
        path: '/v2/company',
        query: { domain: '{{ input.domain }}', company: '{{ input.company }}' },
      },
      verified: false,
      docsUrl: 'https://docs.lusha.com/apis/openapi/company-enrichment',
    },
  ],
  verified: false,
  verificationNotes:
    'GET /v2/person, sus parámetros y la cabecera api_key confirmados en docs.lusha.com (vía índice de búsqueda; el sitio ' +
    'no fue accesible directamente). GET /v2/company y sus parámetros (domain, company) NO se pudieron confirmar: las ' +
    'fuentes mencionan /v2/company y /v2/companies/search. Validar con la referencia viva antes de producción.',
};
