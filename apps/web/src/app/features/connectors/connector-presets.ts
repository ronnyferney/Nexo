import type { ConnectorType } from '../../core/models';

export const CONNECTOR_TYPES: { type: ConnectorType; label: string; description: string; icon: string }[] = [
  { type: 'REST', label: 'API REST', description: 'HTTP/JSON con importación OpenAPI', icon: 'globe' },
  { type: 'SOAP', label: 'Web service SOAP', description: 'SOAP 1.1/1.2 con importación WSDL', icon: 'shuffle' },
  { type: 'GRAPHQL', label: 'GraphQL', description: 'Queries y mutations', icon: 'branch' },
  { type: 'MCP', label: 'Servidor MCP', description: 'Model Context Protocol (HTTP / SSE)', icon: 'sparkles' },
];

export const DEFAULT_CONFIG: Record<ConnectorType, Record<string, unknown>> = {
  REST: { baseUrl: 'https://api.ejemplo.com', openApiUrl: '', headers: {} },
  SOAP: { endpoint: 'https://servicio.ejemplo.com/Service.asmx', wsdlUrl: '', soapVersion: '1.1', headers: {} },
  GRAPHQL: { endpoint: 'https://api.ejemplo.com/graphql', headers: {} },
  MCP: { transport: 'streamable-http', url: 'https://mcp.ejemplo.com/mcp', headers: {} },
};

export const DEFAULT_DEFINITION: Record<ConnectorType, Record<string, unknown>> = {
  REST: { method: 'GET', path: '/recurso/{{ input.id }}', query: {}, headers: {} },
  SOAP: { action: 'http://tempuri.org/Operacion', bodyTemplate: '<Operacion xmlns="http://tempuri.org/"><param>{{ input.param }}</param></Operacion>' },
  GRAPHQL: { query: 'query ($id: ID!) { item(id: $id) { id name } }' },
  MCP: { toolName: 'nombre_de_la_tool' },
};

export const DEFAULT_SCHEMA = { type: 'object', properties: { id: { type: 'string', description: 'Identificador' } }, required: ['id'] };

export const AUTH_TYPES = [
  { type: 'none', label: 'Sin autenticación' },
  { type: 'apiKey', label: 'API Key' },
  { type: 'bearer', label: 'Bearer token' },
  { type: 'basic', label: 'Basic (usuario/clave)' },
  { type: 'oauth2', label: 'OAuth2 client credentials' },
];
