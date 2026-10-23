import type { ConnectorType } from '../../core/models';
import type { DatabaseConfig, DatabaseEngine } from '../../core/integrations.models';

export const CONNECTOR_TYPES: { type: ConnectorType; label: string; description: string; icon: string }[] = [
  { type: 'REST', label: 'API REST', description: 'HTTP/JSON con importación OpenAPI', icon: 'globe' },
  { type: 'SOAP', label: 'Web service SOAP', description: 'SOAP 1.1/1.2 con importación WSDL', icon: 'shuffle' },
  { type: 'GRAPHQL', label: 'GraphQL', description: 'Queries y mutations', icon: 'branch' },
  { type: 'MCP', label: 'Servidor MCP', description: 'Model Context Protocol (HTTP / SSE)', icon: 'sparkles' },
  { type: 'DATABASE', label: 'Base de datos', description: 'PostgreSQL, MySQL o SQL Server con consultas declaradas', icon: 'database' },
];

export const DB_ENGINES: { value: DatabaseEngine; label: string; port: number }[] = [
  { value: 'postgres', label: 'PostgreSQL', port: 5432 },
  { value: 'mysql', label: 'MySQL', port: 3306 },
  { value: 'mssql', label: 'SQL Server', port: 1433 },
];

/** Presets de creación de un conector de base de datos. */
export const DB_PRESETS: { id: string; label: string; description: string; config: DatabaseConfig }[] = [
  {
    id: 'postgres-direct',
    label: 'PostgreSQL en la nube',
    description: 'Conexión directa con TLS',
    config: { engine: 'postgres', mode: 'direct', host: '', port: 5432, database: '', user: '', password: '', ssl: true, allowWrites: false },
  },
  {
    id: 'mysql-direct',
    label: 'MySQL en la nube',
    description: 'Conexión directa con TLS',
    config: { engine: 'mysql', mode: 'direct', host: '', port: 3306, database: '', user: '', password: '', ssl: true, allowWrites: false },
  },
  {
    id: 'mssql-edge',
    label: 'SQL Server on-premise',
    description: 'A través de Nexo Edge, en su red privada',
    config: { engine: 'mssql', mode: 'edge', edgeId: '', connectionKey: '', allowWrites: false },
  },
];

export const DEFAULT_CONFIG: Record<ConnectorType, Record<string, unknown>> = {
  REST: { baseUrl: 'https://api.ejemplo.com', openApiUrl: '', headers: {} },
  SOAP: { endpoint: 'https://servicio.ejemplo.com/Service.asmx', wsdlUrl: '', soapVersion: '1.1', headers: {} },
  GRAPHQL: { endpoint: 'https://api.ejemplo.com/graphql', headers: {} },
  MCP: { transport: 'streamable-http', url: 'https://mcp.ejemplo.com/mcp', headers: {} },
  DATABASE: { ...DB_PRESETS[0].config },
};

export const DEFAULT_DEFINITION: Record<ConnectorType, Record<string, unknown>> = {
  REST: { method: 'GET', path: '/recurso/{{ input.id }}', query: {}, headers: {} },
  SOAP: { action: 'http://tempuri.org/Operacion', bodyTemplate: '<Operacion xmlns="http://tempuri.org/"><param>{{ input.param }}</param></Operacion>' },
  GRAPHQL: { query: 'query ($id: ID!) { item(id: $id) { id name } }' },
  MCP: { toolName: 'nombre_de_la_tool' },
  DATABASE: { sql: 'SELECT *\nFROM tabla\nWHERE id = :id', mode: 'read', maxRows: 500, timeoutMs: 15000 },
};

export const DEFAULT_SCHEMA = { type: 'object', properties: { id: { type: 'string', description: 'Identificador' } }, required: ['id'] };

export const AUTH_TYPES = [
  { type: 'none', label: 'Sin autenticación' },
  { type: 'apiKey', label: 'API Key' },
  { type: 'bearer', label: 'Bearer token' },
  { type: 'basic', label: 'Basic (usuario/clave)' },
  { type: 'oauth2', label: 'OAuth2 client credentials' },
  { type: 'oauth2_code', label: 'OAuth2 de usuario (consentimiento)' },
];
