import type { ConnectorType } from '@prisma/client';

/** Autenticación declarativa. Los valores admiten plantillas: "{{ secrets.CRM_TOKEN }}". */
export type ConnectorAuth =
  | { type: 'none' }
  | { type: 'apiKey'; in: 'header' | 'query'; name: string; value: string }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'oauth2'; tokenUrl: string; clientId: string; clientSecret: string; scope?: string }
  | OAuth2CodeAuth;

/**
 * OAuth2 de usuario (ADR 0005, D3): authorization code + PKCE S256 + refresh token.
 * Los tokens viven cifrados en `OAuthCredential`, nunca en el conector.
 */
export interface OAuth2CodeAuth {
  type: 'oauth2_code';
  /** Proveedor (hubspot, google, microsoft, salesforce...). Define `OAUTH_<PROVEEDOR>_CLIENT_ID/SECRET`. */
  provider: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** App OAuth propia del cliente: plantillas `{{ secrets.X }}`. Vacíos → app de la plataforma (entorno). */
  clientIdRef?: string;
  clientSecretRef?: string;
  /** Parámetros extra de autorización (p. ej. Google: access_type=offline, prompt=consent). */
  authorizeParams?: Record<string, string>;
  /** Etiqueta de la cuenta: campo de la respuesta del token o endpoint (GET con el access token) + ruta. */
  accountLabel?: { tokenField?: string; url?: string; path?: string };
  /** URL de instancia en la respuesta del token (Salesforce `instance_url`) que pasa a ser la base del conector. */
  instanceUrl?: { field: string; allowedHostSuffixes: string[]; baseUrlSuffix?: string };
  /** Vida asumida del access token (s) cuando el proveedor no envía `expires_in` (Salesforce). */
  defaultExpiresIn?: number;
  /** Endpoint de revocación (RFC 7009, POST form `token=`), opcional. */
  revokeUrl?: string;
}

export interface RestConfig {
  baseUrl: string;
  headers?: Record<string, string>;
  openApiUrl?: string;
  timeoutMs?: number;
}

export interface RestOperationDef {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
  bodyType?: 'json' | 'form' | 'text';
  /**
   * Ruta de un campo booleano del cuerpo que confirma el éxito (p. ej. `ok` en Slack, que responde HTTP 200 con
   * `ok: false` ante errores). Si se define y no es `true`, la invocación se considera fallida.
   */
  successPath?: string;
}

export interface SoapConfig {
  endpoint: string;
  wsdlUrl?: string;
  soapVersion?: '1.1' | '1.2';
  headers?: Record<string, string>;
  /** Fragmento XML opcional para <soap:Header> (WS-Security, etc). */
  headerTemplate?: string;
}

export interface SoapOperationDef {
  action: string;
  /** Contenido de <soap:Body>, con plantillas {{ input.x }} (se escapan automáticamente). */
  bodyTemplate: string;
}

export interface GraphqlConfig {
  endpoint: string;
  headers?: Record<string, string>;
}

export interface GraphqlOperationDef {
  query: string;
  variables?: Record<string, unknown>;
}

export interface McpConfig {
  transport: 'streamable-http' | 'sse';
  url: string;
  headers?: Record<string, string>;
}

export interface McpOperationDef {
  toolName: string;
}

export interface ConnectorRuntime {
  id: string;
  workspaceId: string;
  type: ConnectorType;
  config: Record<string, unknown>;
  auth: ConnectorAuth;
  secrets: Record<string, string>;
}

export interface OperationRuntime {
  key: string;
  definition: Record<string, unknown>;
}

export interface InvocationResult {
  ok: boolean;
  status?: number;
  data: unknown;
  durationMs: number;
  meta?: Record<string, unknown>;
}

export interface DiscoveredOperation {
  key: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  definition: Record<string, unknown>;
}

export interface TestResult {
  ok: boolean;
  message: string;
  details?: unknown;
}
