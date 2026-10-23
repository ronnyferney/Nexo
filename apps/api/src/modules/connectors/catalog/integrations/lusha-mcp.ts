import { secretRef, type CatalogEntry } from '../catalog.types';

const MCP_SLUG = 'LUSHA_MCP';

/** Lusha vía su servidor MCP oficial: las tools se importan al instalar (descubrimiento). */
export const lushaMcp: CatalogEntry = {
  id: 'lusha-mcp',
  slug: MCP_SLUG,
  name: 'Lusha (MCP)',
  category: 'PROSPECCION',
  description:
    'Servidor MCP oficial de Lusha: búsqueda de prospectos y enriquecimiento de personas y empresas como tools para agentes.',
  icon: 'search',
  docsUrl: 'https://docs.lusha.com/mcp-docs',
  connectorType: 'MCP',
  config: { transport: 'streamable-http', url: secretRef(MCP_SLUG, 'serverUrl') },
  auth: { mcp: { type: 'apiKey', in: 'header', name: 'x-api-key', value: secretRef(MCP_SLUG, 'apiKey') } },
  credentialFields: [
    {
      key: 'apiKey',
      label: 'API key de Lusha',
      secret: true,
      required: true,
      help: 'Lusha → API Hub → Manage API Keys (solo administradores y managers).',
    },
    {
      key: 'serverUrl',
      label: 'URL del servidor MCP',
      secret: false,
      required: false,
      default: 'https://mcp.lusha.com',
      pattern: String.raw`^https://[A-Za-z0-9.-]+\.lusha\.com(/[A-Za-z0-9._~/-]*)?$`,
      help: 'Deje el valor por defecto o pegue la URL personal que muestra el API Hub de Lusha.',
    },
  ],
  operations: [],
  discoverOnInstall: true,
  verified: false,
  verificationNotes:
    'URL https://mcp.lusha.com y cabecera x-api-key (en minúsculas; Bearer no funciona) según el centro de ayuda de Lusha ' +
    '(info.lusha.com/en/articles/361329). No se pudo confirmar el transporte (se asume Streamable HTTP) ni la "URL personal" ' +
    'del API Hub: docs.lusha.com no fue accesible desde el entorno de verificación.',
};
